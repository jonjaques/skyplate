export interface HasArea {
  area(): number;
  readonly label: string;
}

export abstract class Shape implements HasArea {
  static count = 0;
  protected readonly id: number;
  #secret = 42;

  constructor() {
    Shape.count++;
    this.id = Shape.count;
  }

  abstract area(): number;

  get label(): string {
    return `shape-${this.id}-${this.#reveal()}`;
  }

  set label(value: string) {
    void value;
  }

  #reveal(): number {
    return this.#secret;
  }

  private hidden(): void {}
}

export class Circle extends Shape {
  constructor(private radius: number) {
    super();
  }

  area(): number {
    return Math.PI * this.radius ** 2;
  }

  static unit(): Circle {
    return new Circle(1);
  }
}

export type ShapeList = readonly Shape[];
