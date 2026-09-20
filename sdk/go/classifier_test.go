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

func TestLayaOptions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "laya" || body["processing"] != "bulk" || body["tier"] != "smart" {
			t.Errorf("independent Laya options lost on wire: %#v", body)
		}
		_, _ = w.Write([]byte(`{"results":[{"label":"billing"}]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"invoice"}, Labels: []string{"billing", "support"}, Model: "laya", Processing: "bulk", Tier: "smart",
	})
	if err != nil {
		t.Fatal(err)
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
