// Generic drag-and-drop sortable list with grip-handle interaction.
// Order persists to localStorage under the given storageKey.
import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

function readOrder(key: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeOrder(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(ids));
}

/** Reconcile a saved order with the current set of ids — drops removed, appends new. */
export function reconcileOrder(saved: string[] | null, all: string[]): string[] {
  if (!saved) return all;
  const allSet = new Set(all);
  const savedSet = new Set(saved);
  const filtered = saved.filter((id) => allSet.has(id));
  const additions = all.filter((id) => !savedSet.has(id));
  return [...filtered, ...additions];
}

interface SortableItemProps {
  id: string;
  children: (handle: ReactNode) => ReactNode;
  /** wrapper className applied to the outer sortable element */
  className?: string;
}

function SortableItem({ id, children, className }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto" as const,
  };
  const handle = (
    <button
      type="button"
      ref={setNodeRef as never}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="touch-none cursor-grab active:cursor-grabbing inline-flex items-center justify-center rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(className, isDragging && "ring-2 ring-primary/40 rounded-lg")}>
      {children(handle)}
    </div>
  );
}

interface SortableListProps<T extends { id: string }> {
  items: T[];
  storageKey: string;
  /** Render each item; receives the item plus a drag-handle node to place anywhere. */
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  itemClassName?: string;
  className?: string;
}

export function SortableList<T extends { id: string }>({
  items,
  storageKey,
  renderItem,
  itemClassName,
  className,
}: SortableListProps<T>) {
  const allIds = items.map((i) => i.id);
  const [order, setOrder] = useState<string[]>(() => reconcileOrder(readOrder(storageKey), allIds));

  // Reconcile when source items change (added / removed).
  useEffect(() => {
    setOrder((prev) => {
      const next = reconcileOrder(prev, allIds);
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds.join("|")]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      writeOrder(storageKey, next);
      return next;
    });
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order.map((id) => byId.get(id)).filter((x): x is T => Boolean(x));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {ordered.map((item) => (
            <SortableItem key={item.id} id={item.id} className={itemClassName}>
              {(handle) => renderItem(item, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
