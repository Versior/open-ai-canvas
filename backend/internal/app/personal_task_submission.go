package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type personalTaskSubmission struct {
	id, digest string
}

func (s *Service) submitPersonalTask(userID, key, entry string, intent any, create func(*personalTaskSubmission) (*model.Task, error)) (*model.Task, error) {
	if key == "" {
		return create(nil)
	}
	if strings.TrimSpace(key) != key || len(key) > 160 {
		return nil, BadAuthRequest("任务提交标识无效（最多 160 字节）")
	}
	encoded, err := json.Marshal(intent)
	if err != nil {
		return nil, BadAuthRequest("生成任务参数无效")
	}
	identity := sha256.Sum256([]byte("personal-generation\x00" + userID + "\x00" + key))
	hash := sha256.New()
	hash.Write([]byte(entry + "\x00"))
	hash.Write(encoded)
	submission := &personalTaskSubmission{id: hex.EncodeToString(identity[:16]), digest: hex.EncodeToString(hash.Sum(nil))}
	lookup := func() (*model.Task, error) {
		stored, err := s.repo.TaskForUser(userID, submission.id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if stored.SubmissionHash != submission.digest {
			return nil, idempotencyConflict()
		}
		return taskForOutput(*stored), nil
	}
	if stored, err := lookup(); stored != nil || err != nil {
		return stored, err
	}
	task, err := create(submission)
	if err != nil {
		if stored, lookupErr := lookup(); stored != nil || lookupErr != nil {
			return stored, lookupErr
		}
	}
	return task, err
}

func (submission *personalTaskSubmission) assign(task *model.Task) {
	if submission != nil {
		task.ID, task.SubmissionHash = submission.id, submission.digest
	}
}
