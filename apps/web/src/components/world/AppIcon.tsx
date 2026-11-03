const APP_ICON_URL = `${import.meta.env.BASE_URL}apple-touch-icon.png`;

/** Floripa Code's own icon, worn by the mainland (the Scratch project) where a project shows its favicon. */
export function AppIcon(props: { readonly className?: string }) {
  return <img src={APP_ICON_URL} alt="" className={props.className} />;
}
