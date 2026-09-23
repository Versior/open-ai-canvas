package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const maxCloudAgentArtifactBundles = 16

type cloudAgentArtifactBundleArgs struct {
	BundleID     string `json:"bundleId"`
	SnapshotHash string `json:"snapshotHash,omitempty"`
}

type cloudAgentArtifactBundlePlan struct {
	Bundle     domainmcp.ArtifactBundle
	Call       cloudAgentCall
	CanvasPlan *cloudAgentCanvasMutationPlan
	Preview    cloudAgentApprovalPreview
}

// Artifact Bundles live inside one durable Agent checkpoint. Scope validation
// happens while decoding the checkpoint, while expiry is intentionally checked
// only when applying a bundle so completed historical runs remain readable.
func validateCloudAgentArtifactBundles(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent Artifact Bundle state is missing")
	}
	if len(state.ArtifactBundles) > maxCloudAgentArtifactBundles {
		return errors.New("Agent Artifact Bundle count exceeds the runtime limit")
	}
	for id, bundle := range state.ArtifactBundles {
		if id == "" || id != bundle.ID {
			return errors.New("Agent Artifact Bundle identity is invalid")
		}
		if err := bundle.ValidateScope(run.UserID, state.Request.CanvasID, run.ID); err != nil {
			return fmt.Errorf("Agent Artifact Bundle scope is invalid: %w", err)
		}
	}
	return nil
}

func decodeCloudAgentArtifactBundleArgs(raw string) (cloudAgentArtifactBundleArgs, error) {
	var args cloudAgentArtifactBundleArgs
	if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.BundleID, "Artifact Bundle ID", 128); err != nil {
		return args, cloudAgentFieldError("bundleId", "invalid_value", "Artifact Bundle ID 无效")
	}
	if args.SnapshotHash != "" && len(args.SnapshotHash) != 64 {
		return args, cloudAgentFieldError("snapshotHash", "invalid_value", "Artifact Bundle 画布快照哈希无效")
	}
	return args, nil
}

func prepareCloudAgentArtifactBundleMutation(repo *repository.Repository, userID, canvasID, runID string, state *cloudAgentRuntime, call cloudAgentCall, now time.Time) (*cloudAgentArtifactBundlePlan, error) {
	if repo == nil || state == nil {
		return nil, errors.New("Agent Artifact Bundle planner is unavailable")
	}
	args, err := decodeCloudAgentArtifactBundleArgs(call.Function.Arguments)
	if err != nil {
		return nil, err
	}
	bundle, ok := state.ArtifactBundles[args.BundleID]
	if !ok {
		return nil, WrapAppError(404, "Artifact Bundle 不存在或已被清理", domainmcp.ErrPolicyBlocked)
	}
	if err := bundle.Authorize(userID, canvasID, runID, now); err != nil {
		return nil, cloudAgentArtifactBundleAppError(err)
	}
	ops, err := domainmcp.CompileCanvasRecipe(bundle)
	if err != nil {
		return nil, cloudAgentArtifactBundleAppError(err)
	}
	if args.SnapshotHash == "" {
		canvas, err := repo.CanvasProjectForUser(userID, canvasID)
		if err != nil {
			return nil, err
		}
		doc, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return nil, err
		}
		args.SnapshotHash = cloudAgentCanvasHash(doc)
	}
	canvasArgs := agentCanvasArgs{SnapshotHash: args.SnapshotHash, Ops: make([]agentCanvasOp, 0, len(ops))}
	for _, op := range ops {
		title, content := op.Title, op.Content
		canvasArgs.Ops = append(canvasArgs.Ops, agentCanvasOp{
			Type: "add_node", ID: op.ID, NodeType: op.NodeType,
			Title: &title, Content: &content, X: op.X, Y: op.Y,
		})
	}
	canvasRaw, err := json.Marshal(canvasArgs)
	if err != nil {
		return nil, err
	}
	canvasCall := call
	canvasCall.Function.Name = "canvas_apply_ops"
	canvasCall.Function.Arguments = string(canvasRaw)
	canvasPlan, err := prepareCloudAgentCanvasMutation(repo, userID, canvasID, canvasCall)
	if err != nil {
		return nil, err
	}
	normalizedRaw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	call.Function.Arguments = string(normalizedRaw)
	preview := canvasPlan.Preview
	preview.Kind = "artifact_bundle"
	preview.Title = "确认应用能力包结果"
	preview.Description = fmt.Sprintf("能力包“%s”准备向画布新增 %d 个结果节点。批准后将一次性写入，并可作为一个步骤撤销。", bundle.ToolName, len(canvasPlan.Args.Ops))
	return &cloudAgentArtifactBundlePlan{Bundle: bundle, Call: call, CanvasPlan: canvasPlan, Preview: preview}, nil
}

func applyCloudAgentArtifactBundle(repo *repository.Repository, userID, canvasID, runID string, state *cloudAgentRuntime, call cloudAgentCall, policy RuntimePolicySetting, now time.Time, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentArtifactBundleMutation(repo, userID, canvasID, runID, state, call, now)
	if err != nil {
		return nil, err
	}
	canvasPlan := plan.CanvasPlan
	if err := saveCloudAgentDocument(repo, canvasPlan.Canvas, canvasPlan.Document, policy); err != nil {
		return nil, err
	}
	afterHash := cloudAgentCanvasHash(canvasPlan.Document)
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{
			UserID: userID, CanvasID: canvasID, StepID: call.ID,
			Operation:          "canvas_apply_artifact_bundle",
			BeforeSnapshotHash: canvasPlan.BeforeSnapshotHash,
			AfterSnapshotHash:  afterHash,
			BeforeJSON:         canvasPlan.BeforeJSON, Preview: &plan.Preview,
		}); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"bundleId": plan.Bundle.ID, "toolName": plan.Bundle.ToolName,
		"canvasId": canvasID, "snapshotHash": afterHash,
		"summary": fmt.Sprintf("已将能力包结果作为 %d 个节点写入画布", len(canvasPlan.Args.Ops)),
		"preview": plan.Preview,
	}, nil
}

func cloudAgentArtifactBundleAppError(err error) error {
	var domainErr *domainmcp.DomainError
	if !errors.As(err, &domainErr) {
		return err
	}
	message := strings.TrimSpace(domainErr.Message)
	if message == "" {
		message = "Artifact Bundle 无法应用"
	}
	switch domainErr.Code {
	case domainmcp.ErrorPolicyBlocked:
		return WrapAppError(409, message, err)
	case domainmcp.ErrorInputInvalid, domainmcp.ErrorOutputInvalid, domainmcp.ErrorNoEvidence:
		return &cloudAgentArgumentError{WrapAppError(400, message, err)}
	default:
		return WrapAppError(502, "Artifact Bundle 上游结果暂时不可用", err)
	}
}
