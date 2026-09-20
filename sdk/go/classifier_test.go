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

func TestInputValidation(t *testing.T) {
	cases := []struct {
		name   string
		inputs []string
		labels []string
		msg    string
	}{
		{"no inputs", nil, []string{"a", "b"}, "inputs must hold 1 to 1,000 texts"},
		{"empty inputs", []string{}, []string{"a", "b"}, "inputs must hold 1 to 1,000 texts"},
		{"one label", []string{"x"}, []string{"a"}, "labels must hold 2 to 100 names"},
		{"no labels", []string{"x"}, nil, "labels must hold 2 to 100 names"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (&Client{}).Classify(context.Background(), Request{Inputs: tc.inputs, Labels: tc.labels})
			if err == nil || err.Error() != "classifier.dev: "+tc.msg {
				t.Fatalf("expected %q, got %v", tc.msg, err)
			}
		})
	}
}

func TestMultiLabelHappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		if !req.Multi {
			t.Error("expected multi=true on the wire")
		}
		_, _ = w.Write([]byte(`{"tier":"fast","model":"m","results":[{"labels":["bug","billing"],"scores":{"bug":0.9,"billing":0.8,"praise":0.1}}]}`))
	}))
	defer srv.Close()
	res, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x"}, Labels: []string{"bug", "billing", "praise"}, Multi: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Results[0].Labels) != 2 || res.Results[0].Labels[0] != "bug" {
		t.Fatalf("unexpected multi-label result: %v", res.Results[0])
	}
}

func TestUserAgent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua := r.Header.Get("User-Agent")
		if ua != "classifier-dev-go/0.1.0" {
			t.Errorf("unexpected User-Agent %q", ua)
		}
		conf := 0.5
		_ = json.NewEncoder(w).Encode(Response{Results: []Result{{Label: "a", Confidence: &conf}}})
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{Inputs: []string{"x"}, Labels: []string{"a", "b"}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAPIKeyHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("expected Authorization header")
		}
		conf := 0.5
		_ = json.NewEncoder(w).Encode(Response{Results: []Result{{Label: "a", Confidence: &conf}}})
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL, APIKey: "test-key"}).Classify(context.Background(), Request{Inputs: []string{"x"}, Labels: []string{"a", "b"}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestResultCountMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"label":"a"}]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x", "y"}, Labels: []string{"a", "b"},
	})
	if err == nil {
		t.Fatal("expected error for result count mismatch")
	}
}

func TestTopLevelClassify(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conf := 0.9
		_ = json.NewEncoder(w).Encode(Response{Results: []Result{{Label: "a", Confidence: &conf}}})
	}))
	defer srv.Close()
	// The top-level Classify uses the default client (https://classifier.dev),
	// so we test via Client directly with the mock to keep it offline.
	res, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{Inputs: []string{"x"}, Labels: []string{"a", "b"}})
	if err != nil || res.Results[0].Label != "a" {
		t.Fatalf("got %v, %v", res, err)
	}
}

func TestCancelledContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("should not reach the server")
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := (&Client{BaseURL: srv.URL}).Classify(ctx, Request{Inputs: []string{"x"}, Labels: []string{"a", "b"}})
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestOptionsReachWire(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Tier != "smart" || req.Instructions != "be strict" || !req.Multi || req.MaxLabels != 3 {
			t.Errorf("options not on wire: %+v", req)
		}
		_, _ = w.Write([]byte(`{"results":[{"labels":["a"],"scores":{"a":0.9,"b":0.1}}]}`))
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL}).Classify(context.Background(), Request{
		Inputs: []string{"x"}, Labels: []string{"a", "b"},
		Tier: "smart", Instructions: "be strict", Multi: true, MaxLabels: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
}
