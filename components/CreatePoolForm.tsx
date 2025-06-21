
import React, { useState } from 'react';
import { PlusCircleIcon } from './icons/PhosphorIcons';

interface CreatePoolFormProps {
  onCreatePool: (regionName: string) => void;
}

const CreatePoolForm: React.FC<CreatePoolFormProps> = ({ onCreatePool }) => {
  const [regionName, setRegionName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (regionName.trim()) {
      onCreatePool(regionName.trim());
      setRegionName('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-end">
      <div className="flex-grow">
        <label htmlFor="regionName" className="block mb-1 text-sm font-medium text-slate-300">New Pool Region Name</label>
        <input
          type="text"
          id="regionName"
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
          placeholder="e.g., Delhi, Bangalore"
          className="bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block w-full p-2.5"
          required
        />
      </div>
      <button
        type="submit"
        className="w-full sm:w-auto bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center flex items-center justify-center gap-2"
      >
        <PlusCircleIcon size={20} /> Create Pool
      </button>
    </form>
  );
};

export default CreatePoolForm;