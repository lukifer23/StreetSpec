import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRootStore } from '../stores/rootStore';
import styles from './SearchBox.module.css';

interface SearchBoxProps {
  onPlaceSelected?: (place: google.maps.places.PlaceResult) => void;
  onCoordsEntered?: (coords: { lat: number; lng: number }) => void;
}

const SearchBox: React.FC<SearchBoxProps> = ({ onPlaceSelected, onCoordsEntered }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<google.maps.places.PlaceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const debounceTimer = useRef<number | null>(null);

  const setTargetCoords = useRootStore((state) => state.setTargetCoords);

  const geocoder = useMemo(() => {
    try {
      if (typeof google !== 'undefined' && google.maps?.Geocoder) {
        return new google.maps.Geocoder();
      }
    } catch {}
    return null;
  }, []);

  // Lazy create Places services when API is present
  const services = useMemo(() => {
    try {
      if (typeof google !== 'undefined' && google.maps?.places) {
        const dummy = document.createElement('div');
        const placesService = new google.maps.places.PlacesService(dummy);
        const autocompleteService = new google.maps.places.AutocompleteService();
        return { placesService, autocompleteService } as const;
      }
    } catch {}
    return null;
  }, []);

  const requestPredictions = (query: string) => {
    if (!services?.autocompleteService) return;
    services.autocompleteService.getPlacePredictions({ input: query }, (predictions, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && predictions && predictions.length > 0) {
        // Convert AutocompletePrediction to minimal PlaceResult-like shape for our list
        const results = predictions.slice(0, 5).map((p) => ({
          name: p.structured_formatting?.main_text || p.description,
          formatted_address: p.description,
          place_id: p.place_id,
        })) as unknown as google.maps.places.PlaceResult[];
        setSearchResults(results);
        setShowResults(true);
        setErrorMsg(null);
      }
    });
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    // direct coordinate input like "37.4219,-122.0840"
    const coordMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]!);
      const lng = parseFloat(coordMatch[2]!);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const coords = { lat, lng };
        setTargetCoords(coords);
        onCoordsEntered?.(coords);
        setShowResults(false);
        setSearchQuery('');
        return;
      }
    }

    setIsSearching(true);
    try {
      // Prefer Places Find Place when available to improve hit rate
      if (services?.placesService) {
        const request: google.maps.places.FindPlaceFromQueryRequest = {
          query,
          fields: ['name', 'geometry', 'formatted_address', 'place_id'],
        } as any;
        services.placesService.findPlaceFromQuery(request, (results, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
            setIsSearching(false);
            setSearchResults(results as any);
            setShowResults(true);
            setErrorMsg(null);
            const best = results[0]!;
            const loc = best.geometry?.location as google.maps.LatLng | undefined;
            if (loc) {
              const coords = { lat: loc.lat(), lng: loc.lng() };
              setTargetCoords(coords);
              onCoordsEntered?.(coords);
            }
            return;
          }
          // Fallback to Geocoder if Places fails
          if (geocoder) {
            geocoder.geocode({ address: query }, (geoResults, geoStatus) => {
              setIsSearching(false);
              if (geoStatus === 'OK' && geoResults) {
                const places = geoResults.map((r) => ({
                  name: r.formatted_address,
                  formatted_address: r.formatted_address,
                  geometry: r.geometry as any,
                })) as unknown as google.maps.places.PlaceResult[];
                setSearchResults(places);
                setShowResults(true);
                setErrorMsg(null);
                const best = geoResults[0];
                const loc = best.geometry?.location;
                if (loc) {
                  const coords = {
                    lat: typeof (loc as any).lat === 'function' ? (loc as any).lat() : (loc as any).lat,
                    lng: typeof (loc as any).lng === 'function' ? (loc as any).lng() : (loc as any).lng,
                  } as { lat: number; lng: number };
                  setTargetCoords(coords);
                  onCoordsEntered?.(coords);
                }
              } else {
                setSearchResults([]);
                setShowResults(false);
                const msg = geoStatus === 'REQUEST_DENIED'
                  ? 'API key not authorized for Geocoding/Places.'
                  : 'No results found.';
                setErrorMsg(msg);
              }
            });
          } else {
            setIsSearching(false);
            setSearchResults([]);
            setShowResults(false);
            setErrorMsg('Google Maps is not loaded. Check your API key.');
          }
        });
      } else if (geocoder) {
        geocoder.geocode({ address: query }, (results, status) => {
          setIsSearching(false);
          if (status === 'OK' && results) {
            const places = results.map((r) => ({
              name: r.formatted_address,
              formatted_address: r.formatted_address,
              geometry: r.geometry as any,
            })) as unknown as google.maps.places.PlaceResult[];
            setSearchResults(places);
            setShowResults(true);
            setErrorMsg(null);
            const best = results[0];
            const loc = best.geometry?.location;
            if (loc) {
              const coords = {
                lat: typeof (loc as any).lat === 'function' ? (loc as any).lat() : (loc as any).lat,
                lng: typeof (loc as any).lng === 'function' ? (loc as any).lng() : (loc as any).lng,
              } as { lat: number; lng: number };
              setTargetCoords(coords);
              onCoordsEntered?.(coords);
            }
          } else {
            setSearchResults([]);
            setShowResults(false);
            setErrorMsg(status === 'REQUEST_DENIED' ? 'API key not authorized for Geocoding.' : 'No results found.');
          }
        });
      } else {
        setIsSearching(false);
        setErrorMsg('Google Maps is not loaded. Check your API key.');
      }
    } catch (error) {
      setIsSearching(false);
      console.error('Search error:', error);
      setErrorMsg('Search failed. See console for details.');
    }
  };

  // Autocomplete as user types (debounced)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!services?.autocompleteService || q.length < 3) {
      return;
    }
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => requestPredictions(q), 250) as any;
    return () => {
      if (debounceTimer.current) {
        window.clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [searchQuery, services]);

  const handleResultClick = (place: google.maps.places.PlaceResult) => {
    const applyAndClose = (coords: { lat: number; lng: number }) => {
      setTargetCoords(coords);
      onPlaceSelected?.(place);
      onCoordsEntered?.(coords);
      setShowResults(false);
      setSearchQuery('');
    };

    if (place.geometry?.location) {
      const loc = place.geometry.location as google.maps.LatLng | { lat: () => number; lng: () => number };
      const coords = {
        lat: typeof (loc as any).lat === 'function' ? (loc as any).lat() : (loc as any).lat,
        lng: typeof (loc as any).lng === 'function' ? (loc as any).lng() : (loc as any).lng,
      } as { lat: number; lng: number };
      applyAndClose(coords);
      return;
    }

    if (services?.placesService && place.place_id) {
      services.placesService.getDetails({ placeId: place.place_id, fields: ['geometry', 'name', 'formatted_address'] }, (details, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && details?.geometry?.location) {
          const loc = details.geometry.location;
          applyAndClose({ lat: loc.lat(), lng: loc.lng() });
        }
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className={styles['container']}>
      <div className={styles['searchInput']}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Search for a location..."
          autoComplete="street-address"
        />
        <button
          onClick={handleSearch}
          disabled={isSearching}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>
      {errorMsg && <div className={styles['error']} role="alert">{errorMsg}</div>}
      
      {showResults && searchResults.length > 0 && (
        <div className={styles['results']}>
          {searchResults.map((place, index) => (
            <div
              key={index}
              className={styles['resultItem']}
              onClick={() => handleResultClick(place)}
            >
              <div className={styles['placeName']}>{place.name}</div>
              <div className={styles['placeAddress']}>{place.formatted_address}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBox;
