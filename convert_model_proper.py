# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["torch==2.5.1", "torchvision==0.20.1", "onnx==1.17.0", "onnxruntime==1.20.1", "opencv-python-headless==4.10.0.84", "numpy<2"]
# ///
"""Export existing VKITTI metric weights; validate ONNX against PyTorch. No training."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Pinned upstream Depth-Anything-V2 checkout')
    parser.add_argument('--weights', type=Path, default=Path('models_temp/depth_anything_v2_metric_vkitti_vits.pth'))
    parser.add_argument('--output', type=Path, default=Path('src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx'))
    args = parser.parse_args()
    sys.path.insert(0, str(args.source.resolve() / 'metric_depth'))
    from depth_anything_v2.dpt import DepthAnythingV2
    torch.set_num_threads(4)
    torch.manual_seed(0)
    model = DepthAnythingV2(encoder='vits', features=64, out_channels=[48, 96, 192, 384], max_depth=80)
    model.load_state_dict(torch.load(args.weights, map_location='cpu', weights_only=True), strict=True)
    model.eval()
    candidate = args.output.with_suffix('.candidate.onnx')
    example = torch.randn(1, 3, 518, 518)
    torch.onnx.export(model, example, candidate, opset_version=17, input_names=['input'], output_names=['output'])
    onnx.checker.check_model(str(candidate))
    session = ort.InferenceSession(str(candidate), providers=['CPUExecutionProvider'])
    checks = []
    for height, width in [(518, 518), (518, 518)]:
        sample = torch.randn(1, 3, height, width)
        with torch.no_grad():
            expected = model(sample).numpy()
        actual = session.run(None, {'input': sample.numpy()})[0]
        np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-3)
        assert np.isfinite(actual).all() and (actual >= 0).all() and (actual <= 80).all()
        checks.append({'shape': list(actual.shape), 'max_absolute_error': float(np.max(np.abs(actual-expected)))})
    candidate.replace(args.output)
    provenance = {
        'source': 'https://github.com/DepthAnything/Depth-Anything-V2',
        'source_commit': subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip(),
        'weights_sha256': hashlib.sha256(args.weights.read_bytes()).hexdigest(),
        'onnx_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
        'architecture': 'metric_depth/depth_anything_v2/dpt.py, vits, max_depth=80',
        'input': 'RGB NCHW, (pixel / 255 - [0.485,0.456,0.406]) / [0.229,0.224,0.225], fixed 518x518 with aspect-preserving letterbox',
        'output': 'metric camera-axis depth in meters; field accuracy is not certified',
        'validation': checks,
    }
    args.output.with_suffix('.json').write_text(json.dumps(provenance, indent=2)+'\n')
    print(json.dumps(provenance, indent=2))

if __name__ == '__main__':
    main()
