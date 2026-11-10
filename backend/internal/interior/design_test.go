package interior

import (
	"encoding/json"
	"testing"
)

func TestProjectDesignQuoteAndMarkValidation(t *testing.T) {
	valid := `{"version":1,"marks":[{"id":"fixture-point","floor":0,"layer":"water","label":"待核对给水点","points":[[2,3]],"height":0.5,"depth":0.1,"closed":false}],"prices":{"floor":{"material":null,"labor":0,"waste":10}},"budget":null}`
	if err := validateDesignDocument(json.RawMessage(valid)); err != nil {
		t.Fatal(err)
	}
	for _, design := range []string{
		`{"version":1,"marks":[],"prices":{},"budget":-1}`,
		`{"version":1,"marks":[],"prices":{"floor":{"material":-1,"waste":0}},"budget":null}`,
		`{"version":1,"marks":[{"id":"p","layer":"execute","label":"错误","points":[[1,1]],"depth":0.1}],"prices":{}}`,
		`{"version":1,"marks":[{"id":"p","layer":"power","label":"错误","points":[[1000,1]],"depth":0.1}],"prices":{}}`,
	} {
		payload := json.RawMessage(`{"version":1,"rounds":[],"scenes":[{"id":"scene","design":` + design + `}]}`)
		if _, err := NormalizeProjectDocument(payload); err == nil {
			t.Fatal("invalid design persisted")
		}
	}
	payload := json.RawMessage(`{"version":1,"rounds":[],"scenes":[{"id":"scene","design":` + valid + `}]}`)
	if _, err := NormalizeProjectDocument(payload); err != nil {
		t.Fatal(err)
	}
}
