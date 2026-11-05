package interior

import (
	"slices"
	"testing"
)

func knowledgeIDs(entries []KnowledgeEntry) []string {
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func TestBuiltinKnowledgeCoversEveryBuiltinStyleAndRoom(t *testing.T) {
	entries, err := BuiltinKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	seed, err := BuiltinSeed()
	if err != nil {
		t.Fatal(err)
	}
	covered := map[string]bool{}
	for _, entry := range entries {
		for _, key := range append(append([]string{}, entry.Rooms...), entry.Styles...) {
			covered[key] = true
		}
	}
	for _, preset := range seed.Presets {
		if !covered[preset.Key] {
			t.Errorf("内置%s %s（%s）没有对应的知识条目", preset.Type, preset.Key, preset.Name)
		}
	}
}

func TestRetrieveKnowledgeMatchesScopeRoomStyleAndKeywords(t *testing.T) {
	entries, err := BuiltinKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	villa := knowledgeIDs(RetrieveKnowledge(entries, KnowledgeQuery{Scope: "building", StyleKeys: []string{"new-chinese"}, Text: "三层别墅，前院有围墙和树，二层露台"}))
	for _, id := range []string{"build-villa", "build-roof", "build-courtyard", "build-railing", "style-new-chinese", "clear-overlap"} {
		if !slices.Contains(villa, id) {
			t.Errorf("建筑外观缺少 %s：%v", id, villa)
		}
	}
	for _, id := range []string{"style-nordic", "room-kitchen", "room-beauty"} {
		if slices.Contains(villa, id) {
			t.Errorf("建筑外观不该取到 %s：%v", id, villa)
		}
	}
	kitchen := knowledgeIDs(RetrieveKnowledge(entries, KnowledgeQuery{Scope: "room", RoomKeys: []string{"kitchen"}, Text: "小厨房"}))
	if len(kitchen) == 0 || kitchen[0] != "room-kitchen" || slices.Contains(kitchen, "build-villa") {
		t.Fatalf("厨房 = %v", kitchen)
	}
	// 需求里写到了风格名，没选风格也能取到这个风格的配色。
	if ids := knowledgeIDs(RetrieveKnowledge(entries, KnowledgeQuery{Scope: "room", RoomKeys: []string{"living-room"}, Text: "想要奶油风的客厅"})); !slices.Contains(ids, "style-cream") || !slices.Contains(ids, "room-living") {
		t.Fatalf("奶油风客厅 = %v", ids)
	}
	if got := len(RetrieveKnowledge(entries, KnowledgeQuery{Scope: "home", RoomKeys: []string{"living-room", "master-bedroom", "kitchen", "bathroom", "study"}, Text: "三室两厅 楼梯 阳台 灯 柜"})); got > knowledgeMaxEntries {
		t.Fatalf("取出 %d 条，超过上限", got)
	}
}
