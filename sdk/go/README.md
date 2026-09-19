# classifier.dev Go client

    go get github.com/mrmps/classifier-dev/sdk/go

```go
import classifier "github.com/mrmps/classifier-dev/sdk/go"

results, err := classifier.Classify(ctx,
    []string{"the checkout button does nothing", "love the new dark mode"},
    []string{"bug", "praise", "feature"})
// results[0].Label == "bug"; *results[0].Confidence is a calibrated 0-1
```

No API key. Up to 1,000 texts per call; `Client{}` exposes `Tier`, `Instructions`,
`Multi`, `MaxLabels` and an optional partner `APIKey`. Errors are `*classifier.Error`
with a stable `Code` and, on 429, `RetryAfter`. Docs: https://classifier.dev/developers
