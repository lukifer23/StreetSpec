import React, { useState, useEffect, useMemo } from 'react';
import styles from './LoadingIndicator.module.css';

export interface LoadingState {
  isLoading: boolean;
  progress?: number;
  message?: string;
  type?: 'spinner' | 'progress' | 'skeleton' | 'pulse';
  size?: 'small' | 'medium' | 'large';
  color?: string;
}

interface LoadingIndicatorProps extends LoadingState {
  className?: string;
  overlay?: boolean;
  backdrop?: boolean;
  onComplete?: () => void;
}

// Spinner component with smooth animation
const Spinner: React.FC<{ size: string; color: string }> = React.memo(({ size, color }) => {
  const spinnerStyle = useMemo(() => ({
    width: size === 'small' ? '16px' : size === 'large' ? '32px' : '24px',
    height: size === 'small' ? '16px' : size === 'large' ? '32px' : '24px',
    borderColor: `${color} transparent ${color} transparent`
  }), [size, color]);

  return (
    <div className={styles['spinner']} style={spinnerStyle} />
  );
});

Spinner.displayName = 'Spinner';

// Progress bar component
const ProgressBar: React.FC<{ progress: number; color: string }> = React.memo(({ progress, color }) => {
  const progressStyle = useMemo(() => ({
    width: `${Math.min(100, Math.max(0, progress))}%`,
    backgroundColor: color
  }), [progress, color]);

  return (
    <div className={styles['progressContainer']}>
      <div className={styles['progressBar']} style={progressStyle} />
      <div className={styles['progressText']}>{Math.round(progress)}%</div>
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

// Skeleton loading component
const Skeleton: React.FC<{ size: string }> = React.memo(({ size }) => {
  const skeletonStyle = useMemo(() => ({
    height: size === 'small' ? '12px' : size === 'large' ? '20px' : '16px',
    width: size === 'small' ? '60px' : size === 'large' ? '120px' : '80px'
  }), [size]);

  return (
    <div className={styles['skeleton']} style={skeletonStyle} />
  );
});

Skeleton.displayName = 'Skeleton';

// Pulse loading component
const Pulse: React.FC<{ size: string; color: string }> = React.memo(({ size, color }) => {
  const pulseStyle = useMemo(() => ({
    width: size === 'small' ? '8px' : size === 'large' ? '16px' : '12px',
    height: size === 'small' ? '8px' : size === 'large' ? '16px' : '12px',
    backgroundColor: color
  }), [size, color]);

  return (
    <div className={styles['pulseContainer']}>
      <div className={styles['pulse']} style={pulseStyle} />
      <div className={styles['pulse']} style={{ ...pulseStyle, animationDelay: '0.2s' }} />
      <div className={styles['pulse']} style={{ ...pulseStyle, animationDelay: '0.4s' }} />
    </div>
  );
});

Pulse.displayName = 'Pulse';

const LoadingIndicator: React.FC<LoadingIndicatorProps> = React.memo(({
  isLoading,
  progress,
  message,
  type = 'spinner',
  size = 'medium',
  color = '#007bff',
  className = '',
  overlay = false,
  backdrop = false,
  onComplete
}) => {
  const [show, setShow] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  // Handle loading state transitions
  useEffect(() => {
    if (isLoading) {
      setShow(true);
      setFadeOut(false);
    } else {
      if (show) {
        setFadeOut(true);
        const timer = setTimeout(() => {
          setShow(false);
          onComplete?.();
        }, 300); // Match CSS transition duration
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, show, onComplete]);

  // Auto-hide progress when complete
  useEffect(() => {
    if (progress === 100) {
      const timer = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          setShow(false);
          onComplete?.();
        }, 300);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [progress, onComplete]);

  const containerStyle = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      color
    };

    if (overlay) {
      baseStyle.position = 'absolute';
      baseStyle.top = '50%';
      baseStyle.left = '50%';
      baseStyle.transform = 'translate(-50%, -50%)';
      baseStyle.zIndex = 1000;
    }

    return baseStyle;
  }, [overlay, color]);

  const backdropStyle = useMemo(() => ({
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }), []);

  if (!show && !isLoading) return null;

  const renderContent = () => (
    <div 
      className={`${styles['loadingIndicator']} ${styles[type]} ${styles[size]} ${fadeOut ? styles['fadeOut'] : ''} ${className}`}
      style={containerStyle}
    >
      {type === 'spinner' && <Spinner size={size} color={color} />}
      {type === 'progress' && progress !== undefined && <ProgressBar progress={progress} color={color} />}
      {type === 'skeleton' && <Skeleton size={size} />}
      {type === 'pulse' && <Pulse size={size} color={color} />}
      
      {message && (
        <div className={styles['message']}>
          {message}
        </div>
      )}
    </div>
  );

  if (backdrop) {
    return (
      <div className={`${styles['backdrop']} ${fadeOut ? styles['fadeOut'] : ''}`} style={backdropStyle}>
        {renderContent()}
      </div>
    );
  }

  return renderContent();
});

LoadingIndicator.displayName = 'LoadingIndicator';

// Hook for managing loading states
export const useLoadingState = (initialState: LoadingState = { isLoading: false }) => {
  const [loadingState, setLoadingState] = useState<LoadingState>(initialState);

  const startLoading = useMemo(() => (message?: string, type?: LoadingState['type']) => {
    setLoadingState({
      isLoading: true,
      progress: 0,
      message,
      type: type || 'spinner'
    });
  }, []);

  const updateProgress = useMemo(() => (progress: number, message?: string) => {
    setLoadingState(prev => ({
      ...prev,
      progress,
      message: message || prev.message
    }));
  }, []);

  const stopLoading = useMemo(() => () => {
    setLoadingState(prev => ({
      ...prev,
      isLoading: false
    }));
  }, []);

  const setLoadingStateDirect = useMemo(() => (state: LoadingState) => {
    setLoadingState(state);
  }, []);

  return {
    loadingState,
    startLoading,
    updateProgress,
    stopLoading,
    setLoadingState: setLoadingStateDirect
  };
};

// Global loading context
interface LoadingContextType {
  globalLoading: LoadingState;
  setGlobalLoading: (state: LoadingState) => void;
  showGlobalLoading: (message?: string, type?: LoadingState['type']) => void;
  hideGlobalLoading: () => void;
  updateGlobalProgress: (progress: number, message?: string) => void;
}

const LoadingContext = React.createContext<LoadingContextType | null>(null);

export const LoadingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [globalLoading, setGlobalLoading] = useState<LoadingState>({ isLoading: false });

  const showGlobalLoading = useMemo(() => (message?: string, type?: LoadingState['type']) => {
    setGlobalLoading({
      isLoading: true,
      progress: 0,
      message,
      type: type || 'spinner'
    });
  }, []);

  const hideGlobalLoading = useMemo(() => () => {
    setGlobalLoading(prev => ({ ...prev, isLoading: false }));
  }, []);

  const updateGlobalProgress = useMemo(() => (progress: number, message?: string) => {
    setGlobalLoading(prev => ({
      ...prev,
      progress,
      message: message || prev.message
    }));
  }, []);

  const value = useMemo(() => ({
    globalLoading,
    setGlobalLoading,
    showGlobalLoading,
    hideGlobalLoading,
    updateGlobalProgress
  }), [globalLoading, showGlobalLoading, hideGlobalLoading, updateGlobalProgress]);

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {globalLoading.isLoading && (
        <LoadingIndicator
          {...globalLoading}
          overlay
          backdrop
        />
      )}
    </LoadingContext.Provider>
  );
};

export const useGlobalLoading = () => {
  const context = React.useContext(LoadingContext);
  if (!context) {
    throw new Error('useGlobalLoading must be used within a LoadingProvider');
  }
  return context;
};

export default LoadingIndicator;
