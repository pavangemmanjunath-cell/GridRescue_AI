# Benchmarks

Formal benchmarks against other planning tools or measured installations are not available yet (see [docs/novelty.md](../docs/novelty.md#evidence-still-required)). This folder holds the one evaluation that is reproducible today: how well the classifier agrees with the engine.

## Classifier agreement with the engine

### Objective

Measure how often the Random Forest's first pick matches the system family the full engine recommends, on sites it has not seen.

### Baseline Methods

- One CART decision tree trained on the same data.
- Always predicting the most common family in the training set.

### Environment

Windows 11, Python 3.13.5, 13th Gen Intel Core i7-1355U, no GPU. Pure Python; no ML library.

### Dataset

10,000 synthetic sites generated and labelled by the engine with seed 2026; the first 8,000 train, the last 2,000 test. Synthetic, not real sites (see [DATA_CARD.md](../DATA_CARD.md)).

### Metrics

Held-out accuracy, top-2 accuracy, per-family recall.

### Command

```bash
cd backend
python -m app.ml.train_backup_classifier --out ../benchmarks/results/backup_classifier_repro.json
```

The run takes about ten minutes on the laptop above. Files named `*_repro.json` are git-ignored.

### Results — v1.0.0

| Model | Held-out accuracy |
|---|---|
| Random Forest, 30 trees | **80.4 %** |
| Random Forest, top-2 | 94.5 % |
| Single CART tree | 76.9 % |
| Most-common-family baseline | 46.5 % |

The reproduction run produced a model file byte-identical to the shipped `backend/app/data/backup_classifier_model.json` (SHA-256 `7243d7cb15fb6ecf…`). Full metadata, including per-family recall and the label distribution, is in [results/ml_classifier_v1.0.0.json](results/ml_classifier_v1.0.0.json).

### Limitations

- The metric is agreement with the engine, not correctness on real sites.
- Rare families (wind-only, flow, hydrogen) have too few examples to be predicted.
- One seed; no confidence interval across seeds yet.

## Contributing a benchmark

Benchmarks comparing the engine with a full-year tool, measured data or engineers' designs are welcome; see [CONTRIBUTING.md](../CONTRIBUTING.md#research-contributions). Report the environment, data, metric, command and result, and never estimate a result you did not run.
