import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', className = '', children, ...props }) => {
  const baseClasses = "px-6 py-3 font-bold border-4 border-black box-shadow-brutal transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none uppercase tracking-wider";
  
  let variantClasses = "";
  if (variant === 'primary') variantClasses = "bg-[#3DDC84] text-black";
  if (variant === 'secondary') variantClasses = "bg-white text-black";
  if (variant === 'danger') variantClasses = "bg-red-500 text-white";

  return (
    <button className={`${baseClasses} ${variantClasses} ${className}`} {...props}>
      {children}
    </button>
  );
};
