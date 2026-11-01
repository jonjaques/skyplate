// A local JSX namespace stands in for React's types, so the fixture has no dependencies.
declare global {
  namespace JSX {
    interface Element {
      readonly tag: string;
    }
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}

export function useCounter(start: number): [number, () => void] {
  let value = start;
  return [value, () => void value++];
}

interface ButtonProps {
  label: string;
  onPress?: () => void;
}

export function Button(props: ButtonProps) {
  return <button onClick={props.onPress}>{props.label}</button>;
}

export const Toolbar = () => {
  const [count, inc] = useCounter(0);
  return (
    <div>
      <Button label={String(count)} onPress={inc} />
      <Button label="again" />
    </div>
  );
};

export function Badge({ label }: ButtonProps) {
  return <span>{label}</span>;
}
