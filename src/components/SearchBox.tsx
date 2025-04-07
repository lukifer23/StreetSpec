import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import styles from './SearchBox.module.css'; // Import CSS Module

// Regex to match typical Lat, Lng formats (allows variations)
const latLngRegex = /^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/;

interface SearchBoxProps {
  onPlaceSelected: (place: google.maps.places.PlaceResult) => void;
  onCoordsEntered: (coords: { lat: number; lng: number }) => void; // New callback
  apiKey: string; // Still needed for potential future direct API calls, though Autocomplete might use the global one
}

const SearchBox: React.FC<SearchBoxProps> = ({ onPlaceSelected, onCoordsEntered, apiKey }) => {
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
              console.log("No details available for input: '" + place.name + "'");
              return;
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

  }, [onPlaceSelected]); // Re-run only if callback changes

  // Handle Enter key press for coordinate check
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const trimmedValue = inputValue.trim();
      const match = trimmedValue.match(latLngRegex);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        // Basic validation for latitude/longitude ranges
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          console.log("Coordinate input detected:", { lat, lng });
          onCoordsEntered({ lat, lng });
          // Prevent Autocomplete from trying to fetch details for raw coords
          event.preventDefault(); 
        }
      }
      // If it doesn't match regex, let Autocomplete handle it (if user selected a suggestion)
      // Or do nothing if they just typed random text and hit Enter.
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder="Search location or enter Lat, Lng..."
      className={styles.searchInput} // Apply class from CSS Module
      value={inputValue} // Control the input value
      onChange={(e) => setInputValue(e.target.value)} // Update state on change
      onKeyDown={handleKeyDown} // Handle Enter key
    />
  );
};

export default SearchBox; 