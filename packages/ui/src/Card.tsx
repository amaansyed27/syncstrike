import React from 'react';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => {
  return (
    <div className={`bg-white border-4 border-black box-shadow-brutal p-6 ${className}`} {...props}>
      {children}
    </div>
  );
};
