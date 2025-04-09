import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import styles from './SearchBox.module.css'; // Import CSS Module

// Regex for Decimal Degrees (Lat, Lng)
const decimalLatLngRegex = /^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/;

// Regex for Degrees Minutes Seconds (DMS) - More robust
const dmsRegex = /(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])?[,\s]+(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([EW])?/i;

interface SearchBoxProps {
  onPlaceSelected: (place: google.maps.places.PlaceResult) => void;
  onCoordsEntered: (coords: { lat: number; lng: number }) => void; // New callback
}

// Function to convert DMS to Decimal Degrees
function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (direction === 'S' || direction === 'W') {
        decimal = decimal * -1;
    }
    return decimal;
}

const SearchBox: React.FC<SearchBoxProps> = ({ onPlaceSelected, onCoordsEntered }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null); // Use ref to hold instance
  const [inputValue, setInputValue] = useState(''); // Track input value

  useEffect(() => {
    // Ensure the API is loaded and the input element exists
    if (inputRef.current && window.google && window.google.maps && window.google.maps.places) {
      // Initialize Autocomplete only once
      if (!autocompleteRef.current) {
        console.log("SearchBox: Initializing Autocomplete");
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
                console.warn("No details available for input: '" + inputValue + "' (and not valid coordinates)");
              }
              return; // Don't proceed if no geometry or valid coords
            }
            console.log("Place selected:", place);
            onPlaceSelected(place);
          }
        });
      }
    } else {
      // Log if API isn't ready when effect runs
      console.warn("SearchBox: Google Maps API not ready or input ref missing.");
    }

    // Cleanup: Autocomplete might add listeners to the document,
    // Although docs aren't explicit, it *might* be safer to remove listeners
    // or somehow disconnect the instance if the component unmounts,
    // but for now, we assume it handles its own lifecycle tied to the input element.
    // return () => {
    //   if (autocompleteRef.current) {
    //     // How to properly clean up Autocomplete? google.maps.event.clearInstanceListeners?
    //     console.log("SearchBox: Cleaning up Autocomplete instance (Placeholder)");
    //   }
    // };

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
        console.log("Coordinate input detected:", coords);
        onCoordsEntered(coords);
        // Prevent Autocomplete from trying to fetch details for raw coords
        event.preventDefault(); 
        // Optionally clear input or update it to decimal format?
        // setInputValue(`${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`); 
      } else {
        console.log(`No details available for input: '${trimmedValue}'`);
        // If not coords, let Autocomplete handle it (if user picked a suggestion)
        // Or if they just hit enter on random text, Autocomplete listener 
        // should handle the lack of geometry.
      }
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder="Search location or enter Lat, Lng (or DMS)"
      className={styles.searchInput} // Apply class from CSS Module
      value={inputValue} // Control the input value
      onChange={(e) => setInputValue(e.target.value)} // Update state on change
      onKeyDown={handleKeyDown} // Handle Enter key
    />
  );
};

export default SearchBox; 