# Public release and provenance

StreetSpec was developed as a private project and was subsequently sold. The NDAs that previously restricted public disclosure have expired, allowing this public release of the project.

This repository represents the public code release, not a complete archive of the private commercial deployment. Some model checkpoints were custom tuned. Confidential checkpoints, proprietary training and evaluation datasets, customer data, and private deployment configuration are not included in the public release. Their absence must not be interpreted as evidence that the public baseline reproduces the custom system's performance.

Accuracy was verified privately for the original system. Mileage may vary with the public release: the excluded tuning and data mean its results should not be assumed identical to that privately verified configuration. Private validation details and datasets remain confidential.

Public baseline models must be identified by their upstream source, license, version and checksum. Rebuilding an ONNX graph from public weights verifies interoperability; it does not recover confidential tuning or establish measurement accuracy. Synthetic fixtures in this repository test mathematical behavior, not field accuracy.

Do not commit credentials, customer project exports, private imagery, custom checkpoints or confidential datasets. Keep private assets outside the checkout. Public availability does not grant rights to separately licensed model weights or third-party imagery.

The public review and its verification limits are recorded in [REVIEW.md](REVIEW.md). Do not restore claims of commercial accuracy or release readiness without reproducible evidence for the public configuration.

## Included public baseline

The tracked VKITTI Small PyTorch weights have SHA-256 `9203e538d35255c90dda4b7fedb47ff33fe725497bcca3b1e53b3a65ee63f0cb`, identical to the [upstream public file](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/blob/main/depth_anything_v2_metric_vkitti_vits.pth). The rebuilt ONNX graph derives only from these weights. These two baseline assets are distinct from the excluded proprietary tuning. Conversion provenance is in `src/assets/models/depth_anything_v2_metric_vkitti_vits.json`.
