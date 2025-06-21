
import React from 'react';
import { ShieldIcon } from './icons/PhosphorIcons';

const Header: React.FC = () => {
  return (
    <header className="bg-slate-800 shadow-lg">
      <div className="container mx-auto px-4 md:px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <ShieldIcon size={32} className="text-sky-400" />
          <h1 className="text-xl font-bold text-sky-400">Project Aegis</h1>
        </div>
        <nav className="space-x-4">
          {/* Future navigation links can go here */}
          <span className="text-slate-400 hover:text-sky-400 cursor-pointer">Dashboard</span>
        </nav>
      </div>
    </header>
  );
};

export default Header;