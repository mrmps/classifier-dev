export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!small && (
        <span>
          classifier<span className="brand-domain">.dev</span>
        </span>
      )}
    </span>
  );
}
