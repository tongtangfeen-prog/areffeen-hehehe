import React, { useState } from 'react';
import { CakeSlice } from 'lucide-react';

interface SafeImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel,
}) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#EAF5FF] via-[#F7FBFF] to-[#FFFDF8] text-[#567394] p-4 ${className}`}
        role="img"
        aria-label={alt}
      >
        <CakeSlice className="w-8 h-8 text-[#6FB4EB] mb-1.5" />
        <span className="text-xs font-medium text-center line-clamp-2">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
