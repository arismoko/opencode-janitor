import { useState } from 'https://esm.sh/preact@10.26.2/hooks';

export function useFlash() {
  const [flash, setFlash] = useState(null);

  const showFlash = (message, tone = 'info') => {
    setFlash({ message, tone });
    setTimeout(() => setFlash(null), 2400);
  };

  return {
    flash,
    showFlash,
  };
}
