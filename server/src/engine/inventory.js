// Tracks the fuel in ONE tank (one product) and what each litre cost.
//
// Two costing methods:
//   'WAC'  - weighted average cost. All fuel in the tank is blended into one
//            average price; every litre sold costs that average.
//   'FIFO' - first in, first out. The oldest delivery is assumed to sell first.

export const EPS = 1e-6;

export class Inventory {
  /**
   * @param {'WAC'|'FIFO'} method
   * @param {{litres:number, costPerLitre:number}} [opening] stock already in the tank
   */
  constructor(method = 'WAC', opening) {
    if (method !== 'WAC' && method !== 'FIFO') {
      throw new Error(`Unknown costing method: ${method}`);
    }
    this.method = method;
    this.layers = []; // [{ litres, costPerLitre }], oldest first
    this.lastCost = opening?.costPerLitre ?? null; // fallback when the tank is empty
    if (opening && opening.litres > 0) this.receive(opening.litres, opening.costPerLitre);
  }

  get litres() {
    return this.layers.reduce((s, l) => s + l.litres, 0);
  }

  get value() {
    return this.layers.reduce((s, l) => s + l.litres * l.costPerLitre, 0);
  }

  /** Average cost per litre of what is in the tank now. */
  get averageCost() {
    const litres = this.litres;
    return litres > EPS ? this.value / litres : this.lastCost;
  }

  /** A delivery arrives. */
  receive(litres, costPerLitre) {
    if (!(litres > 0)) return;
    if (this.method === 'WAC' && this.layers.length > 0) {
      const layer = this.layers[0];
      const total = layer.litres + litres;
      layer.costPerLitre = (layer.litres * layer.costPerLitre + litres * costPerLitre) / total;
      layer.litres = total;
    } else {
      this.layers.push({ litres, costPerLitre });
    }
  }

  /**
   * Fuel leaves the tank. Returns the total COST of those litres.
   * (WAC keeps a single layer, so it always draws at the average.)
   */
  consume(litres) {
    if (!(litres > EPS)) return 0;
    if (litres > this.litres + EPS) {
      throw new Error(`Cannot take ${litres} L from a tank holding ${this.litres} L`);
    }
    let remaining = litres;
    let cost = 0;
    while (remaining > EPS && this.layers.length > 0) {
      const layer = this.layers[0];
      const take = Math.min(layer.litres, remaining);
      cost += take * layer.costPerLitre;
      layer.litres -= take;
      remaining -= take;
      if (layer.litres <= EPS) {
        this.lastCost = layer.costPerLitre;
        this.layers.shift();
      }
    }
    return cost;
  }
}
