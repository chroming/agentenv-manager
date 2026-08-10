interface ProgressBarProps {
  label: string;
  className?: string;
}

export const ProgressBar = ({ label, className = "" }: ProgressBarProps) => (
  <span
    aria-label={label}
    className={`ui-progress-bar ${className}`.trim()}
    role="progressbar"
  >
    <span />
  </span>
);
