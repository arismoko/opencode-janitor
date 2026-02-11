import {
  useEffect,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';

export function useCapabilities(options = {}) {
  const [capabilities, setCapabilities] = useState(null);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const refreshCapabilities = async () => {
    const response = await api('/v1/capabilities');
    setCapabilities(response);
  };

  useEffect(() => {
    refreshCapabilities().catch((error) => {
      onErrorRef.current?.(error);
    });
  }, []);

  return {
    capabilities,
    refreshCapabilities,
  };
}
