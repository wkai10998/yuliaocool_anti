
import React from 'react';

interface NavbarProps {
  title?: string;
  className?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ title = "yuliaocool", className = "" }) => {
  return (
    <nav className={`h-16 border-b border-stone-100 bg-white/80 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-stone-800 flex items-center justify-center text-white font-serif font-bold text-xs">
          L
        </div>
        <span className="font-serif font-semibold text-stone-800 tracking-tight">{title}</span>
      </div>
    </nav>
  );
};
