import React, { useState, useEffect, useRef, KeyboardEvent, useCallback } from 'react';
import styles from './SearchBox.module.css'; // Import CSS Module
import { useCameraStore } from '../stores/cameraStore';

// Regex for Decimal Degrees (Lat, Lng)
const decimalLatLngRegex = /^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/;

// Regex for Degrees Minutes Seconds (DMS) - More robust
const dmsRegex = /(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])?[,\s]+(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([EW])?/i;

// Function to convert DMS to Decimal Degrees
function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (direction === 'S' || direction === 'W') {
        decimal = decimal * -1;
    }
    return decimal;
}

const SearchBox: React.FC = () => {
  const { setTargetCoords } = useCameraStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null); // Use ref to hold instance
  const [inputValue, setInputValue] = useState(''); // Track input value
  const [error, setError] = useState('');

  const onPlaceSelected = useCallback((place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      setTargetCoords({
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      });
    }
  }, [setTargetCoords]);

  const onCoordsEntered = useCallback((coords: { lat: number; lng: number }) => {
    setTargetCoords(coords);
  }, [setTargetCoords]);

  useEffect(() => {
    // Ensure the API is loaded and the input element exists
    if (inputRef.current && window.google && window.google.maps && window.google.maps.places) {
      // Initialize Autocomplete only once
      if (!autocompleteRef.current) {
        const options = {
          fields: ['geometry', 'name', 'formatted_address'] 
        };
        const ac = new google.maps.places.Autocomplete(inputRef.current, options);
        autocompleteRef.current = ac; // Store instance in ref

        // Add listener for place selection
        ac.addListener('place_changed', () => {
          if (autocompleteRef.current) {
            const place = autocompleteRef.current.getPlace();
            if (!place.geometry || !place.geometry.location) {
              // Check if input *might* be coordinates before logging error
              const potentialCoords = parseCoordinates(inputValue.trim());
              if (!potentialCoords) {
                setError('Please enter valid coordinates.');
              }
              return; // Don't proceed if no geometry or valid coords
            }
            onPlaceSelected(place);
            setError('');
          }
        });
      }
    }
  }, [onPlaceSelected, inputValue]); // Added inputValue dependency to check coords if Autocomplete fails

  // Function to parse both Decimal and DMS coordinates
  const parseCoordinates = (value: string): { lat: number; lng: number } | null => {
    // Try Decimal first
    let match = value.match(decimalLatLngRegex);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    // Try DMS second
    match = value.match(dmsRegex);
    if (match) {
        const latDegrees = parseInt(match[1], 10);
        const latMinutes = parseInt(match[2], 10);
        const latSeconds = parseFloat(match[3]);
        const latDirection = match[4]?.toUpperCase();

        const lngDegrees = parseInt(match[5], 10);
        const lngMinutes = parseInt(match[6], 10);
        const lngSeconds = parseFloat(match[7]);
        const lngDirection = match[8]?.toUpperCase();

        if (!latDirection || !lngDirection) return null; // Need N/S and E/W

        const lat = dmsToDecimal(latDegrees, latMinutes, latSeconds, latDirection);
        const lng = dmsToDecimal(lngDegrees, lngMinutes, lngSeconds, lngDirection);

        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          return { lat, lng };
        }
    }
    
    return null; // No valid format matched
  };

  // Handle Enter key press for coordinate check
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const trimmedValue = inputValue.trim();
      const coords = parseCoordinates(trimmedValue);

      if (coords) {
        onCoordsEntered(coords);
        setError('');
        // Prevent Autocomplete from trying to fetch details for raw coords
        event.preventDefault();
        // Optionally clear input or update it to decimal format?
        // setInputValue(`${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
      } else {
        setError('Please enter valid coordinates.');
      }
    }
  };

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search location or enter Lat, Lng (or DMS)"
        title="Enter coordinates in decimal degrees or DMS format"
        aria-label="Search location or enter coordinates in decimal degrees or degrees, minutes, seconds format"
        className={styles.searchInput} // Apply class from CSS Module
        value={inputValue} // Control the input value
        onChange={(e) => {
          const value = e.target.value;
          const trimmed = value.trim();
          setInputValue(value);
          if (error && (!trimmed || parseCoordinates(trimmed))) {
            setError('');
          }
        }} // Update state on change
        onKeyDown={handleKeyDown} // Handle Enter key
      />
      {error && (
        <div className={styles.error} aria-live="polite" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default SearchBox;
