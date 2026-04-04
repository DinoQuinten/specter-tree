export interface Animal {
  name: string;
  speak(): string;
}

export class Dog implements Animal {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  speak(): string {
    return `${this.name} says woof`;
  }

  fetch(item: string): string {
    return `${this.name} fetches ${item}`;
  }
}

export class Cat implements Animal {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  speak(): string {
    return `${this.name} says meow`;
  }
}

export function greetAnimal(animal: Animal): string {
  return `Hello, ${animal.speak()}`;
}

export type AnimalKind = 'dog' | 'cat';

export enum PetStatus {
  Active = 'active',
  Inactive = 'inactive'
}
