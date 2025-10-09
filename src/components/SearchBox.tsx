import React, { useState } from 'react';
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

  const { setTargetCoords } = useRootStore();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
  

    setIsSearching(true);
    try {
      // Use Google Places API for search
      const service = new google.maps.places.PlacesService(document.createElement('div'));
      const request = {
        query: searchQuery,
        fields: ['name', 'geometry', 'formatted_address']
      };

      service.textSearch(request, (results, status) => {
        setIsSearching(false);
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          setSearchResults(results);
          setShowResults(true);
        }
      });
    } catch (error) {
      setIsSearching(false);
      console.error('Search error:', error);
    }
  };

  const handleResultClick = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      const coords = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      };
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
    <div className={styles['searchBox']}>
      <div className={styles['searchInput']}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Search for a location..."
          className={styles['input']}
        />
        <button
          onClick={handleSearch}
          disabled={isSearching}
          className={styles['searchButton']}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>
      
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
