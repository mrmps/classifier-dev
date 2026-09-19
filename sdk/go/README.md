# classifier.dev Go client

    go get github.com/mrmps/classifier-dev/sdk/go

```go
import classifier "github.com/mrmps/classifier-dev/sdk/go"

results, err := classifier.Classify(ctx,
    []string{"the checkout button does nothing", "love the new dark mode"},
    []string{"bug", "praise", "feature"})
// results[0].Label == "bug"; *results[0].Confidence is a calibrated 0-1
```

No API key. Up to 1,000 texts per call (200 for public smart requests). For the rest, build a `Request` and send it
through a `Client`:

```go
c := &classifier.Client{}                       // BaseURL, HTTPClient and a partner APIKey are optional
res, err := c.Classify(ctx, classifier.Request{
    Inputs:       texts,
    Labels:       []string{"databases", "ml", "frontend"},
    Tier:         "smart",                      // re-asks uncertain answers of a reasoning model
    Instructions: "judge the main topic only",
    Multi:        true,                         // every label that applies, a score per label
    MaxLabels:    2,
})
// res.Results[i].Labels, res.Results[i].Scores, res.Usage.Escalated
```

`MaxLabels` implies multi-label output and rejects negative values. Malformed
successful response shapes return errors. HTTP errors are `*classifier.Error` with the API's message, a stable `Code`, the HTTP
`Status` and, on 429, `RetryAfter`. A request that never got an answer returns the
`net/http` error as is. Docs: https://classifier.dev/developers
