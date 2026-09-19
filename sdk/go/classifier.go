// Package classifier is the official Go client for classifier.dev: zero-shot
// text classification over plain HTTP, no API key.
//
//	results, err := classifier.Classify(ctx, []string{"the app crashes", "love it"}, []string{"bug", "praise"})
//	// results[0].Label == "bug", results[0].Confidence ~ 0.99
//
// One request carries up to 1,000 texts and returns in about a second. The
// zero value of Client uses https://classifier.dev and http.DefaultClient.
package classifier

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// Client talks to one classifier.dev deployment. The zero value is ready to use.
type Client struct {
	// BaseURL defaults to https://classifier.dev.
	BaseURL string
	// HTTPClient defaults to http.DefaultClient.
	HTTPClient *http.Client
	// APIKey is optional: a partner key that lifts the per-IP limits.
	APIKey string
}

// Request is the body of POST /v1/classify.
type Request struct {
	Inputs       []string `json:"inputs"`
	Labels       []string `json:"labels"`
	Tier         string   `json:"tier,omitempty"`         // "fast" (default) or "smart"
	Instructions string   `json:"instructions,omitempty"` // extra criteria
	Multi        bool     `json:"multi,omitempty"`        // every label that applies
	MaxLabels    int      `json:"max_labels,omitempty"`   // cap for multi-label
}

// Result is one answer, in the order of the inputs.
type Result struct {
	Label      string             `json:"label"`      // single-label
	Labels     []string           `json:"labels"`     // multi-label
	Confidence *float64           `json:"confidence"` // calibrated 0-1; nil when withheld
	Scores     map[string]float64 `json:"scores"`
	Escalated  bool               `json:"escalated"`
	Unscored   string             `json:"unscored,omitempty"`
	Model      string             `json:"model"`
}

// Response is the body of a successful call.
type Response struct {
	Tier       string   `json:"tier"`
	Model      string   `json:"model"`
	ModelsUsed []string `json:"modelsUsed"`
	Results    []Result `json:"results"`
	Usage      struct {
		Classifications  int `json:"classifications"`
		Escalated        int `json:"escalated"`
		EscalationFailed int `json:"escalation_failed"`
		MS               int `json:"ms"`
	} `json:"usage"`
}

// Error is a non-2xx answer: a message and a stable code. On 429, RetryAfter
// says how long to wait.
type Error struct {
	Status     int           `json:"-"`
	Message    string        `json:"error"`
	Code       string        `json:"code"`
	RetryAfter time.Duration `json:"-"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("classifier.dev: %s (%s, HTTP %d)", e.Message, e.Code, e.Status)
}

// Classify sends one request. Inputs: 1-1,000 texts; labels: 2-100 names.
func (c *Client) Classify(ctx context.Context, req Request) (*Response, error) {
	if len(req.Inputs) == 0 || len(req.Inputs) > 1000 {
		return nil, errors.New("classifier.dev: inputs must hold 1 to 1,000 texts")
	}
	if len(req.Labels) < 2 || len(req.Labels) > 100 {
		return nil, errors.New("classifier.dev: labels must hold 2 to 100 names")
	}
	base := c.BaseURL
	if base == "" {
		base = "https://classifier.dev"
	}
	hc := c.HTTPClient
	if hc == nil {
		hc = http.DefaultClient
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/classify", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "classifier-dev-go/0.1.0")
	if c.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	res, err := hc.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		e := &Error{Status: res.StatusCode, Message: fmt.Sprintf("HTTP %d", res.StatusCode), Code: "http_" + strconv.Itoa(res.StatusCode)}
		_ = json.Unmarshal(raw, e)
		if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil {
			e.RetryAfter = time.Duration(s) * time.Second
		}
		return nil, e
	}
	var out Response
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("classifier.dev: bad response: %w", err)
	}
	if len(out.Results) != len(req.Inputs) {
		return nil, fmt.Errorf("classifier.dev: %d results for %d inputs", len(out.Results), len(req.Inputs))
	}
	return &out, nil
}

// Classify is the one-line form: one label per text, fast tier, default client.
func Classify(ctx context.Context, inputs, labels []string) ([]Result, error) {
	res, err := (&Client{}).Classify(ctx, Request{Inputs: inputs, Labels: labels})
	if err != nil {
		return nil, err
	}
	return res.Results, nil
}
