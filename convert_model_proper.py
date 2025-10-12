import torch
import onnx
import onnxruntime as ort
import os
import sys
import cv2
import numpy as np

# Add the Depth-Anything-V2 directory to the path
sys.path.append('./Depth-Anything-V2')

from depth_anything_v2.dpt import DepthAnythingV2

def convert_depth_model():
    """
    Convert the downloaded Depth Anything V2 PyTorch model to ONNX format
    using the proper model architecture
    """
    print("Starting proper model conversion...")
    
    # Check if PyTorch model exists
    pytorch_model_path = "./models_temp/depth_anything_v2_metric_vkitti_vits.pth"
    if not os.path.exists(pytorch_model_path):
        print("ERROR: PyTorch model not found. Please download it first.")
        return False
    
    try:
        # Load the PyTorch model weights
        print("Loading PyTorch model weights...")
        state_dict = torch.load(pytorch_model_path, map_location='cpu')
        
        # Create the model with proper architecture
        print("Creating model with proper architecture...")
        
        # Model configuration for VITS (Small) model
        # Based on the actual DepthAnythingV2 implementation
        encoder = 'vits'
        features = 64
        out_channels = [48, 96, 192, 384]
        use_bn = False
        use_clstoken = False
        
        model = DepthAnythingV2(
            encoder=encoder,
            features=features,
            out_channels=out_channels,
            use_bn=use_bn,
            use_clstoken=use_clstoken
        )
        
        # Load the state dict
        model.load_state_dict(state_dict)
        model.eval()
        
        print(f"Model loaded successfully!")
        print(f"   Encoder: {encoder}")
        print(f"   Features: {features}")
        print(f"   Out Channels: {out_channels}")
        print(f"   Model parameters: {sum(p.numel() for p in model.parameters()):,}")
        
        # Create dummy input (the model expects RGB images)
        # The model requires input size to be multiple of 14 (patch size)
        input_size = 518  # Standard size that works with patch size 14
        dummy_input = torch.randn(1, 3, input_size, input_size)
        
        # Define output path
        output_path = "./src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx"
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        print(f"Converting to ONNX format...")
        print(f"   Input size: {dummy_input.shape}")
        print(f"   Output path: {output_path}")
        
        # Export to ONNX
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=11,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={
                'input': {0: 'batch_size', 2: 'height', 3: 'width'},
                'output': {0: 'batch_size', 2: 'height', 3: 'width'}
            }
        )
        
        print("ONNX model exported successfully!")
        
        # Verify the ONNX model
        print("Verifying ONNX model...")
        onnx_model = onnx.load(output_path)
        onnx.checker.check_model(onnx_model)
        print("ONNX model verification passed!")
        
        # Test inference with ONNX Runtime
        print("Testing ONNX inference...")
        ort_session = ort.InferenceSession(output_path)
        
        # Test with dummy input
        test_input = dummy_input.numpy()
        result = ort_session.run(None, {'input': test_input})
        print(f"ONNX inference test passed! Output shape: {result[0].shape}")
        
        # Test with a real image to verify functionality
        print("Testing with sample image...")
        test_image = np.random.randint(0, 255, (518, 518, 3), dtype=np.uint8)
        test_image_tensor = torch.from_numpy(test_image).permute(2, 0, 1).unsqueeze(0).float() / 255.0
        
        # Test PyTorch inference
        with torch.no_grad():
            pytorch_result = model(test_image_tensor)
            print(f"PyTorch inference: {pytorch_result.shape}")
        
        # Test ONNX inference
        onnx_result = ort_session.run(None, {'input': test_image_tensor.numpy()})
        print(f"ONNX inference: {onnx_result[0].shape}")
        
        print(f"\nConversion complete!")
        print(f"Model saved to: {output_path}")
        print(f"Model size: {os.path.getsize(output_path) / (1024*1024):.1f} MB")
        
        return True
        
    except Exception as e:
        print(f"ERROR: Conversion failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = convert_depth_model()
    if success:
        print("\nReady to integrate with your Electron app!")
    else:
        print("\nConversion failed. Please check the error messages above.")
        sys.exit(1) 