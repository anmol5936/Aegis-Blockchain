
// Using simple SVG placeholders for Phosphor Icons to keep it self-contained
// In a real app, you'd use a library like `phosphor-react`
import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  weight?: string; // "bold", "light", etc. - not used in this simple version
}

export const ShieldIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208,48H48A16,16,0,0,0,32,64V176a16,16,0,0,0,16,16H88.54l25.49,38.23a16.07,16.07,0,0,0,27.94,0L167.46,192H208a16,16,0,0,0,16-16V64A16,16,0,0,0,208,48Zm0,128H172.16a16.08,16.08,0,0,0-13.93,8L128,220,97.77,184a16.08,16.08,0,0,0-13.93-8H48V64H208Z"></path></svg>
);

export const InfoIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"></path></svg>
);

export const DollarSignIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M168,128a40,40,0,0,1-40,40H112v24a8,8,0,0,1-16,0V168H88a8,8,0,0,1,0-16h8V120H80a8,8,0,0,1,0-16H96V80a8,8,0,0,1,16,0V96h16a40,40,0,0,1,0,80Zm-40-64H112v48h16a24,24,0,0,0,0-48Z"></path></svg>
);

export const UsersIcon: React.FC<IconProps> = ({ size = 24, className }) => (
 <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M100,44A36,36,0,1,0,64,80,36,36,0,0,0,100,44Zm0-16A52,52,0,1,1,48,80,52,52,0,0,1,100,28Zm144,200a8,8,0,0,1-8,8H20a8,8,0,0,1,0-16H232A8,8,0,0,1,244,228Zm-60-20a8,8,0,0,0-6.15-7.87C160.89,193.07,137.28,188,100,188c-34.93,0-56.55,4.35-73.53,10.6A8,8,0,0,0,20,208H148a8,8,0,0,0,7.91-6.55,108.31,108.31,0,0,1,28-26.85C171,185.39,157.37,180,148,180H124A59.72,59.72,0,0,0,73.47,164.2c-1.39-4.7-2.61-9.51-3.66-14.39A75.92,75.92,0,0,1,128,104a75.31,75.31,0,0,1,20.21,3.23c11.69,3.53,13.11,5.29,18,17.4A52.2,52.2,0,0,1,192,128a51.4,51.4,0,0,1-1.39,12.28C194.24,142.92,197.8,154.61,197.8,168A44.3,44.3,0,0,1,184,208Z"></path></svg>
);

export const BarChartIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M240,208H40a8,8,0,0,1-8-8V40a8,8,0,0,1,16,0v152H240a8,8,0,0,1,0,16ZM96,168a8,8,0,0,0,8-8V120a8,8,0,0,0-16,0v40A8,8,0,0,0,96,168Zm48,0a8,8,0,0,0,8-8V88a8,8,0,0,0-16,0v72A8,8,0,0,0,144,168Zm48,0a8,8,0,0,0,8-8V104a8,8,0,0,0-16,0v56A8,8,0,0,0,192,168Z"></path></svg>
);

export const TrendingUpIcon: React.FC<IconProps> = ({ size = 24, className }) => (
 <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M232,56a8,8,0,0,0-8,8V97.55l-65.78-65.78a8,8,0,0,0-11.31,0L104,74.69,40.46,11.16a8,8,0,1,0-11.31,11.31L88.69,76,128,36.69,202.45,111.13H168a8,8,0,0,0,0,16h56a8,8,0,0,0,8-8V64A8,8,0,0,0,232,56Z"></path></svg>
);

export const AlertTriangleIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M236.78,186.11,148.91,34.24a24,24,0,0,0-41.82,0L19.22,186.11A23.92,23.92,0,0,0,40.13,224H215.87A23.92,23.92,0,0,0,236.78,186.11Zm-16,21.78H40.13a8,8,0,0,1-6.94-12.05L120.91,44.24a8,8,0,0,1,13.89,0l87.72,151.87A8,8,0,0,1,215.87,208ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"></path></svg>
);

export const GiftIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M216,80H176a48,48,0,0,0-96,0H40a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H56v64a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V144h16a16,16,0,0,0,16-16V96A16,16,0,0,0,216,80ZM128,56a32,32,0,0,1,32,32H96A32,32,0,0,1,128,56Zm72,144H56V144H96v16a8,8,0,0,0,16,0V144h32v16a8,8,0,0,0,16,0V144h40ZM40,96H216v32H40Z"></path></svg>
);

export const PlusCircleIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm48-88a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z"></path></svg>
);

export const XIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path></svg>
);

export const ArrowUpIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208.49,152.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L116,187V40a12,12,0,0,1,24,0V187l51.51-51.52a12,12,0,0,1,17,17Z" transform="rotate(180 128 128)"></path></svg>
);

export const ArrowDownIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208.49,152.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L116,187V40a12,12,0,0,1,24,0V187l51.51-51.52a12,12,0,0,1,17,17Z"></path></svg>
);

export const ArrowCircleRightIcon: React.FC<IconProps> = ({ size = 24, className }) => (
 <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm45.66-94.34-48-48a8,8,0,0,0-11.32,11.32L152.69,120H88a8,8,0,0,0,0,16h64.69l-38.35,38.34a8,8,0,0,0,11.32,11.32l48-48A8,8,0,0,0,173.66,121.66Z"></path></svg>
);

export const CheckCircleIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm45.66-124.66L116.34,147,90.34,121.05a8,8,0,0,0-11.31,11.31l32,32a8,8,0,0,0,11.32,0l64-64a8,8,0,0,0-11.32-11.32Z"></path></svg>
);

export const WalletIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M213.66,69.66l-88-88a8,8,0,0,0-11.32,0l-88,88A8,8,0,0,0,24,72V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V72A8,8,0,0,0,213.66,69.66ZM40,88H216V200H40ZM128,34.34,209.66,116H46.34ZM180,144a12,12,0,1,1-12-12A12,12,0,0,1,180,144Z"></path></svg>
);
export const CoinsIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M148,136H100a4,4,0,0,0-4,4v56a4,4,0,0,0,4,4h48a4,4,0,0,0,4-4V140A4,4,0,0,0,148,136Zm-4,56H104V144h40Z M100,32a76,76,0,0,0-76,76,8,8,0,0,0,16,0,60,60,0,0,1,120,0,8,8,0,0,0,16,0A76,76,0,0,0,100,32Zm0,92a68.08,68.08,0,0,0-67.63,60H76a20,20,0,0,0,40,0h24a20,20,0,0,0,40,0h43.63A68.08,68.08,0,0,0,100,124Z M180,92a8,8,0,0,0-8-8,44,44,0,0,0-83.33,0,8,8,0,0,0,14.66,4.67A28,28,0,0,1,124,76a27.57,27.57,0,0,1,6.86,1.25A8,8,0,0,0,136,72a8,8,0,0,0,4-14.9A44.75,44.75,0,0,0,124,56a43.49,43.49,0,0,0-23.83,6.83,8,8,0,1,0,8.83,12.42A28,28,0,0,1,124,60a28.53,28.53,0,0,1,12.7,2.83,8,8,0,0,0,9.15-1.16A8,8,0,0,0,148.7,53a43.56,43.56,0,0,0-24.7-8,44,44,0,0,0-27.33,79.13A8,8,0,0,0,100,128a8,8,0,0,0,3.11-15.35A28,28,0,0,1,84,96a27.41,27.41,0,0,1,1.41-8.58A8,8,0,0,0,76,80a8,8,0,0,0-7.42,4.86A44,44,0,0,0,172,96a8,8,0,0,0-8-8Z"></path></svg>
);

export const TrendingDownIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M232,136v56a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h34.45L128,111.13,88.69,150.45,31.16,92.91a8,8,0,0,1,11.31-11.31L88,127.31l39.31-39.32,74.53,74.54V136a8,8,0,0,1,16,0Z"></path></svg>
);

export const UserCircleIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm0-152a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,64Zm0,112c-35.35,0-66,17.75-72.28,42.54a87.65,87.65,0,0,1,144.56,0C194,193.75,163.35,176,128,176Z"></path></svg>
);
export const PauseIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M88,48a8,8,0,0,0-8,8V200a8,8,0,0,0,16,0V56A8,8,0,0,0,88,48Zm80,0a8,8,0,0,0-8,8V200a8,8,0,0,0,16,0V56A8,8,0,0,0,168,48Z"></path></svg>
);
export const PlayIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M240,128a15.79,15.79,0,0,1-7.74,13.63l-160,96A16,16,0,0,1,48,224V32a16,16,0,0,1,24.26-13.63l160,96A15.79,15.79,0,0,1,240,128Z"></path></svg>
);

export const ShieldCheckIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208,48H48A16,16,0,0,0,32,64V176a16,16,0,0,0,16,16H88.54l25.49,38.23a16.07,16.07,0,0,0,27.94,0L167.46,192H208a16,16,0,0,0,16-16V64A16,16,0,0,0,208,48Zm-33,65.51-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path></svg>
);
export const ShieldWarningIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className}><path d="M208,48H48A16,16,0,0,0,32,64V176a16,16,0,0,0,16,16H88.54l25.49,38.23a16.07,16.07,0,0,0,27.94,0L167.46,192H208a16,16,0,0,0,16-16V64A16,16,0,0,0,208,48Zm0,128H172.16a16.08,16.08,0,0,0-13.93,8L128,220,97.77,184a16.08,16.08,0,0,0-13.93-8H48V64H208ZM120,104v32a8,8,0,0,0,16,0V104a8,8,0,0,0-16,0Zm20,56a12,12,0,1,0-12-12A12,12,0,0,0,140,160Z"></path></svg>
);
export const LogOutIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className}>
    <path d="M112,216a8,8,0,0,1-8,8H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h56a8,8,0,0,1,0,16H48V208h56A8,8,0,0,1,112,216Zm109.66-90.34L180.34,84.34a8,8,0,0,0-11.32,11.32L190.06,117H104a8,8,0,0,0,0,16h86.06l-21.04,21.04a8,8,0,0,0,11.32,11.32l41.32-41.32A8,8,0,0,0,221.66,125.66Z"/>
  </svg>
);
export const EditIcon: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className}>
    <path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/>
  </svg>
);


// Add any other icons you need in a similar fashion
