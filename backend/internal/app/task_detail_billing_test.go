package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestTaskDetailBillingUsesOwnerAndSettledAmount(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.Task{}, &model.BillingOrder{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "billing-task", UserID: "owner", Status: model.TaskStatusSucceeded, BillingOrderID: "billing-order", InputJSON: `{"config":{"apiKey":"fake-private-key"}}`}
	order := model.BillingOrder{ID: "billing-order", UserID: "owner", TaskID: task.ID, IdempotencyKey: "billing-task", Status: model.BillingStatusSettled, AmountMicrocredits: 1000000, ActualAmountMicrocredits: 600000, RefundedAmountMicrocredits: 400000}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	detail, err := svc.TaskWithBilling("owner", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Billing == nil || detail.Billing.ChargedMicrocredits == nil || *detail.Billing.ChargedMicrocredits != 600000 || detail.Billing.RefundedMicrocredits != 400000 {
		t.Fatalf("detail lost settled/refunded amounts: %+v", detail.Billing)
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var public map[string]any
	if err := json.Unmarshal(raw, &public); err != nil {
		t.Fatal(err)
	}
	if public["id"] != task.ID || public["billing"] == nil || strings.Contains(string(raw), "fake-private-key") {
		t.Fatal("detail changed existing JSON shape or leaked protected input")
	}
	if _, err := svc.TaskWithBilling("other-user", task.ID); err == nil {
		t.Fatal("another user could read task billing")
	}
	if err := db.Model(&order).Updates(map[string]any{"status": model.BillingStatusRefunded, "actual_amount_microcredits": 0, "refunded_amount_microcredits": 1000000}).Error; err != nil {
		t.Fatal(err)
	}
	detail, err = svc.TaskWithBilling("owner", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Billing.Status != model.BillingStatusRefunded || detail.Billing.ChargedMicrocredits != nil || detail.Billing.RefundedMicrocredits != 1000000 {
		t.Fatalf("refund reported as a charge: %+v", detail.Billing)
	}
}
