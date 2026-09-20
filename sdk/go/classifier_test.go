package classifier

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClassify(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		if r.URL.Path != "/v1/classify" || len(req.Inputs) != 2 {
			t.Errorf("unexpected request %s %v", r.URL.Path, req)
		}
		conf := 0.9
		_ = json.NewEncoder(w).Encode(Response{Results: []Result{{Label: "bug", Confidence: &conf}, {Label: "praise", Confidence: &conf}}})
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL}
	res, err := c.Classify(context.Background(), Request{Inputs: []string{"crash", "love"}, Labels: []string{"bug", "praise"}})
	if err != nil || res.Results[1].Label != "praise" {
		t.Fatalf("got %v, %v", res, err)
	}
}

func TestErrorShape(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"error":"Rate limit","code":"rate_limit_minute"}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{Inputs: []string{"x"}, Labels: []string{"a", "b"}})
	e, ok := err.(*Error)
	if !ok || e.Code != "rate_limit_minute" || e.RetryAfter.Seconds() != 7 {
		t.Fatalf("got %v", err)
	}
}

func TestResponseShapeAndMaxLabels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		if !req.Multi || req.MaxLabels != 1 {
			t.Errorf("max_labels must imply multi in the wire request: %#v", req)
		}
		_, _ = w.Write([]byte(`{"results":[{}]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x"}, Labels: []string{"a", "b"}, MaxLabels: 1,
	})
	if err == nil || err.Error() != "classifier.dev: bad response: result 0 has no multi-label answer" {
		t.Fatalf("expected a shape error, got %v", err)
	}
	_, err = (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x"}, Labels: []string{"a", "b"}, MaxLabels: -1,
	})
	if err == nil || err.Error() != "classifier.dev: max_labels must be a whole number above 0" {
		t.Fatalf("expected max_labels validation, got %v", err)
	}
}

func TestSingleResultShape(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"label":null}]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x"}, Labels: []string{"a", "b"},
	})
	if err == nil || err.Error() != "classifier.dev: bad response: result 0 has no single-label answer" {
		t.Fatalf("expected a shape error, got %v", err)
	}
}

func TestClassifyDimensions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["labels"]; ok {
			t.Error("dimensions request must not carry labels")
		}
		items := body["items"].([]interface{})
		dims := body["dimensions"].(map[string]interface{})
		results := make([]map[string]interface{}, len(items))
		for i := range items {
			fields := map[string]interface{}{}
			for name, dim := range dims {
				d := dim.(map[string]interface{})
				labels := d["labels"].([]interface{})
				conf := 0.85
				fields[name] = map[string]interface{}{
					"label": labels[0], "confidence": conf,
					"scores": map[string]interface{}{labels[0].(string): conf},
					"model": "jev-test", "ms": 50,
				}
			}
			results[i] = map[string]interface{}{"dimensions": fields}
		}
		out := map[string]interface{}{
			"tier": "fast", "model": "jev-test", "modelsUsed": []string{"jev-test"},
			"results": results, "usage": map[string]interface{}{
				"items": len(items), "dimensions": len(dims),
				"classifications": len(items) * len(dims),
			},
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	defer srv.Close()

	c := &Client{BaseURL: srv.URL}
	res, err := c.ClassifyDimensions(context.Background(), DimensionRequest{
		Items: []string{"checkout broke"},
		Dimensions: map[string]Dimension{
			"team": {Labels: []string{"billing", "platform"}},
			"kind": {Labels: []string{"bug", "request"}, Instructions: "bug = broken"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(res.Results))
	}
	if res.Results[0].Dimensions["team"].Label != "billing" {
		t.Errorf("expected billing, got %s", res.Results[0].Dimensions["team"].Label)
	}
	if res.Results[0].Dimensions["kind"].Label != "bug" {
		t.Errorf("expected bug, got %s", res.Results[0].Dimensions["kind"].Label)
	}
}

func TestClassifyDimensionsValidation(t *testing.T) {
	cases := []struct {
		name string
		req  DimensionRequest
		msg  string
	}{
		{"no items", DimensionRequest{Dimensions: map[string]Dimension{"a": {Labels: []string{"x", "y"}}}}, "items must hold 1 to 1,000 texts"},
		{"no dimensions", DimensionRequest{Items: []string{"x"}}, "dimensions must hold 1 to 20 entries"},
		{"empty dimensions", DimensionRequest{Items: []string{"x"}, Dimensions: map[string]Dimension{}}, "dimensions must hold 1 to 20 entries"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (&Client{}).ClassifyDimensions(context.Background(), tc.req)
			if err == nil || err.Error() != "classifier.dev: "+tc.msg {
				t.Fatalf("expected %q, got %v", tc.msg, err)
			}
		})
	}
}

func TestClassifyDimensionsResultCountMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).ClassifyDimensions(context.Background(), DimensionRequest{
		Items: []string{"x"}, Dimensions: map[string]Dimension{"a": {Labels: []string{"x", "y"}}},
	})
	if err == nil {
		t.Fatal("expected error for result count mismatch")
	}
}
