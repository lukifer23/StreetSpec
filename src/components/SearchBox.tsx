import React, { useMemo, useState } from 'react';
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

  const setTargetCoords = useRootStore((state) => state.setTargetCoords);

  const geocoder = useMemo(() => {
    try {
      if (typeof google !== 'undefined' && google.maps?.Geocoder) {
        return new google.maps.Geocoder();
      }
    } catch {}
    return null;
  }, []);


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
      if (geocoder) {
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

  const handleResultClick = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      const loc = place.geometry.location as google.maps.LatLng | { lat: () => number; lng: () => number };
      const coords = {
        lat: typeof (loc as any).lat === 'function' ? (loc as any).lat() : (loc as any).lat,
        lng: typeof (loc as any).lng === 'function' ? (loc as any).lng() : (loc as any).lng,
      } as { lat: number; lng: number };
      setTargetCoords(coords);
      onPlaceSelected?.(place);
      onCoordsEntered?.(coords);
      setShowResults(false);
      setSearchQuery('');
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
