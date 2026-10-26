export class RepeatGate {
  private direction = 0;
  private next = 0;
  update(direction: number, now: number): number {
    if (!direction) { this.direction = 0; return 0; }
    if (direction !== this.direction) { this.direction = direction; this.next = now + 380; return direction; }
    if (now >= this.next) { this.next = now + 145; return direction; }
    return 0;
  }
  reset() { this.direction = 0; this.next = 0; }
}
