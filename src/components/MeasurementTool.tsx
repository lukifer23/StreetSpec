import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Point, CameraParams, Measurement } from '../types/common';
import { createMeasurement } from '../services/measurement';
import styles from './MeasurementTool.module.css';

interface MeasurementToolProps {
  cameraParams: CameraParams | null; // Receive current camera state
  onMeasurementComplete: (measurement: Measurement) => void; // Callback to save measurement
  measurements: Measurement[]; // Add prop for completed measurements
}

type MeasurementPhase = 'idle' | 'placingStart' | 'placingEnd';

const MeasurementTool: React.FC<MeasurementToolProps> = ({ cameraParams, onMeasurementComplete, measurements }) => {
  const [phase, setPhase] = useState<MeasurementPhase>('idle');
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isActive = phase !== 'idle';

  // Function to get click coordinates relative to the overlay
  const getClickCoords = (event: React.MouseEvent<HTMLDivElement>): Point | null => {
    if (!overlayRef.current) return null;
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cameraParams || !isActive) return; // Ignore clicks if not active or no camera data

    const coords = getClickCoords(event);
    if (!coords) return;

    if (phase === 'placingStart') {
      console.log("Start Point Placed:", coords);
      setStartPoint(coords);
      setPhase('placingEnd');
      setCurrentMousePos(coords); // Initialize line drawing
    } else if (phase === 'placingEnd') {
      console.log("End Point Placed:", coords);
      setEndPoint(coords);
      setPhase('idle'); // Measurement finished, go back to idle
      setCurrentMousePos(null);

      if (startPoint) {
        try {
          // Get view dimensions from the overlay ref
          const viewWidth = overlayRef.current?.offsetWidth;
          const viewHeight = overlayRef.current?.offsetHeight;

          if (!viewWidth || !viewHeight) {
              console.error("Could not get view dimensions for measurement.");
              throw new Error("View dimensions unavailable.");
          }

          // Pass dimensions to createMeasurement
          const newMeasurement = createMeasurement(
              startPoint, 
              coords, // This is the endPoint screen coords
              cameraParams, 
              viewWidth, 
              viewHeight
          );
          onMeasurementComplete(newMeasurement);
        } catch (error) {
            console.error("Error creating measurement:", error);
            // TODO: Add user feedback for error
        }
      }
      // Reset points for next measurement
      setStartPoint(null);
      setEndPoint(null);
    }
  };

  // Track mouse movement for drawing line preview
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (phase === 'placingEnd') {
      const coords = getClickCoords(event);
      setCurrentMousePos(coords);
    }
  };

  // TODO: Add keyboard handler (e.g., Escape to cancel measurement)

  // Drawing Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const overlay = overlayRef.current;

    if (!context || !canvas || !overlay) return;

    // Ensure canvas matches overlay size
    canvas.width = overlay.offsetWidth;
    canvas.height = overlay.offsetHeight;

    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // --- Draw Completed Measurements --- 
    context.strokeStyle = '#ff00ff'; // Magenta for completed
    context.fillStyle = '#ff00ff';
    context.lineWidth = 2;
    context.font = '12px Arial';
    context.textAlign = 'center';

    measurements.forEach(m => {
      if (!m.startPoint || !m.endPoint) return; // Skip if points missing

      // Draw start point
      context.beginPath();
      context.arc(m.startPoint.x, m.startPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      // Draw end point
      context.beginPath();
      context.arc(m.endPoint.x, m.endPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      // Draw line
      context.beginPath();
      context.moveTo(m.startPoint.x, m.startPoint.y);
      context.lineTo(m.endPoint.x, m.endPoint.y);
      context.stroke();

      // Draw distance text near the midpoint
      const midX = (m.startPoint.x + m.endPoint.x) / 2;
      const midY = (m.startPoint.y + m.endPoint.y) / 2;
      context.fillStyle = 'white'; // White text
      context.shadowColor = 'black'; // Black shadow for contrast
      context.shadowBlur = 4;
      // TODO: Use actual calculated distance when available
      context.fillText(`${m.distance.toFixed(2)}m`, midX, midY - 10); 
      context.shadowBlur = 0; // Reset shadow
      context.fillStyle = '#ff00ff'; // Reset fill style

    });

    // Style for drawing
    context.strokeStyle = '#ff00ff'; // Magenta color
    context.fillStyle = '#ff00ff';
    context.lineWidth = 2;
    const pointRadius = 4;

    // Draw start point if placed
    if (startPoint) {
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, pointRadius, 0, Math.PI * 2);
      context.fill();
    }

    // Draw line preview if placing end point
    if (phase === 'placingEnd' && startPoint && currentMousePos) {
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(currentMousePos.x, currentMousePos.y);
      context.stroke();

      // Draw temporary end point (cursor position)
      context.beginPath();
      context.arc(currentMousePos.x, currentMousePos.y, pointRadius, 0, Math.PI * 2);
      context.fill();
    }

    // --- Draw Current Measurement (if active) --- 
    if (!isActive) return;

    // Use 'context' instead of 'ctx'
    context.strokeStyle = '#00ffff'; // Cyan for active
    context.fillStyle = '#00ffff';
    context.lineWidth = 2;

    // Draw start point if placed
    if (startPoint) {
        context.beginPath(); // Use context
        context.arc(startPoint.x, startPoint.y, 5, 0, 2 * Math.PI); // Use context
        context.fill(); // Use context
    }

    // Draw line preview to mouse position
    // Use 'mousePos' instead of 'currentMousePos'
    if (startPoint && currentMousePos && phase === 'placingEnd') {
        context.beginPath(); // Use context
        context.moveTo(startPoint.x, startPoint.y); // Use context
        context.lineTo(currentMousePos.x, currentMousePos.y); // Use context and mousePos
        context.setLineDash([5, 5]); // Dashed line for preview
        context.stroke(); // Use context
        context.setLineDash([]); // Reset line dash
    }

    // If a measurement was just completed (endPoint is set but phase is idle?)
    // We might need a different way to show completed measurement line briefly?
    // Or maybe that belongs to a separate display layer.

  }, [phase, startPoint, currentMousePos]);

  // TEMP: Button to start measurement (Replace with proper UI control later)
  const startMeasurement = () => {
    console.log("Starting measurement...");
    setPhase('placingStart');
    setStartPoint(null);
    setEndPoint(null);
    setCurrentMousePos(null);
  };

  return (
    // Use class name conditional for pointer-events
    <div 
      ref={overlayRef}
      className={`${styles.overlay} ${isActive ? styles.overlayActive : ''}`}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
    >
        {/* Temporary Start Button - Position absolute or in a control panel */}
        {!isActive && (
            <button 
                onClick={(e) => { e.stopPropagation(); startMeasurement(); }} 
                style={{ 
                    position: 'absolute', 
                    bottom: '20px', 
                    left: '50%', 
                    transform: 'translateX(-50%)', 
                    zIndex: 10, 
                    padding: '10px 15px',
                    pointerEvents: 'auto' // Ensure button is always clickable
                }}
            >
                Start Measuring
            </button>
        )}
        {isActive && (
            <div style={{ 
                position: 'absolute', 
                bottom: '20px', 
                left: '10px', 
                color: 'white', 
                backgroundColor: 'rgba(0,0,0,0.6)', 
                padding: '5px',
                pointerEvents: 'none' // Info text shouldn't block clicks
             }}>
                {phase === 'placingStart' ? 'Click to place START point' : 'Click to place END point'} (Esc to cancel)
            </div>
        )}
        
        <canvas ref={canvasRef} className={styles.measurementCanvas} />
    </div>
  );
};

export default MeasurementTool; 