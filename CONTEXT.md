# Classification

classifier.dev assigns caller-supplied labels to text. The same input can be
classified once, against several independent labels, or across named dimensions.

## Language

**Input**: One text supplied for classification. Its position identifies its
corresponding result.

**Label**: One category the caller supplies. Single-label classification chooses
one; multi-label classification can choose several or none.

**Dimension**: A named classification task with its own labels and optional
instructions. Each input receives one decision for every requested dimension.

**Decision**: One classification of an input against a label set. An input with
three dimensions requires three decisions.

**Scores**: The model's probabilities for the supplied labels. Single-label
scores form a distribution; multi-label scores describe independent choices.
They do not establish whether the supplied labels cover the input.

**Confidence**: The model's confidence in its selected label. It can differ from
that label's score, and is unavailable when no comparable estimate exists.

**Escalation**: Re-asking an uncertain decision with a reasoning model. The new
answer does not inherit the first model's confidence or scores.

**Fallback**: Using another model because the preferred model could not answer.
This differs from escalation, which starts with a valid but uncertain answer.
