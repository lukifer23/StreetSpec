import { create } from 'zustand';
import { CameraParams, OnnxDepthMap, DecodedDepthData } from '../types/common';

interface CameraState {
  targetCoords: { lat: number; lng: number } | null;
  currentCameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  depthData: DecodedDepthData | null;
  setTargetCoords: (coords: { lat: number; lng: number } | null) => void;
  setCurrentCameraParams: (params: CameraParams | null) => void;
  setOnnxDepthMap: (depthMap: OnnxDepthMap | null) => void;
  setDepthData: (depthData: DecodedDepthData | null) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  targetCoords: null,
  currentCameraParams: null,
  onnxDepthMap: null,
  depthData: null,
  setTargetCoords: (coords) => set({ targetCoords: coords }),
  setCurrentCameraParams: (params) => set({ currentCameraParams: params }),
  setOnnxDepthMap: (depthMap) => set({ onnxDepthMap: depthMap }),
  setDepthData: (depthData) => set({ depthData: depthData }),
}));
