import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  text,
  children,
  position = 'top',
  delay = 300,
  className = ''
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<NodeJS.Timeout>();
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        });
      }
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getTooltipStyle = () => {
    const baseStyle: React.CSSProperties = {
      position: 'fixed',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '14px',
      maxWidth: '300px',
      whiteSpace: 'normal',
      wordWrap: 'break-word',
      zIndex: 1000,
      pointerEvents: 'none',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'scale(1)' : 'scale(0.95)',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
    };

    switch (position) {
      case 'bottom':
        return {
          ...baseStyle,
          top: coords.y + 10,
          left: coords.x,
          transform: `translateX(-50%) ${isVisible ? 'translateY(0)' : 'translateY(-5px)'}`,
        };
      case 'left':
        return {
          ...baseStyle,
          top: coords.y,
          right: window.innerWidth - coords.x + 10,
          transform: `translateY(-50%) ${isVisible ? 'translateX(0)' : 'translateX(5px)'}`,
        };
      case 'right':
        return {
          ...baseStyle,
          top: coords.y,
          left: coords.x + 10,
          transform: `translateY(-50%) ${isVisible ? 'translateX(0)' : 'translateX(-5px)'}`,
        };
      default: // top
        return {
          ...baseStyle,
          bottom: window.innerHeight - coords.y + 10,
          left: coords.x,
          transform: `translateX(-50%) ${isVisible ? 'translateY(0)' : 'translateY(5px)'}`,
        };
    }
  };

  const getArrowStyle = () => {
    const arrowSize = 6;
    const baseStyle: React.CSSProperties = {
      position: 'fixed',
      width: 0,
      height: 0,
      zIndex: 1001,
      pointerEvents: 'none',
    };

    switch (position) {
      case 'bottom':
        return {
          ...baseStyle,
          top: coords.y + 4,
          left: coords.x,
          borderLeft: `${arrowSize}px solid transparent`,
          borderRight: `${arrowSize}px solid transparent`,
          borderBottom: `${arrowSize}px solid rgba(0, 0, 0, 0.9)`,
          transform: 'translateX(-50%)',
        };
      case 'left':
        return {
          ...baseStyle,
          top: coords.y,
          right: window.innerWidth - coords.x + 4,
          borderTop: `${arrowSize}px solid transparent`,
          borderBottom: `${arrowSize}px solid transparent`,
          borderLeft: `${arrowSize}px solid rgba(0, 0, 0, 0.9)`,
          transform: 'translateY(-50%)',
        };
      case 'right':
        return {
          ...baseStyle,
          top: coords.y,
          left: coords.x + 4,
          borderTop: `${arrowSize}px solid transparent`,
          borderBottom: `${arrowSize}px solid transparent`,
          borderRight: `${arrowSize}px solid rgba(0, 0, 0, 0.9)`,
          transform: 'translateY(-50%)',
        };
      default: // top
        return {
          ...baseStyle,
          bottom: window.innerHeight - coords.y + 4,
          left: coords.x,
          borderLeft: `${arrowSize}px solid transparent`,
          borderRight: `${arrowSize}px solid transparent`,
          borderTop: `${arrowSize}px solid rgba(0, 0, 0, 0.9)`,
          transform: 'translateX(-50%)',
        };
    }
  };

  return (
    <div
      ref={triggerRef}
      className={`tooltip-trigger ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: 'inline-block' }}
    >
      {children}
      {isVisible && (
        <>
          <div style={getTooltipStyle()}>
            {text}
          </div>
          <div style={getArrowStyle()} />
        </>
      )}
    </div>
  );
};
