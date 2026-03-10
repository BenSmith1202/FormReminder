from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass
class FakeDocumentSnapshot:
    id: str
    _data: Optional[Dict[str, Any]]

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data or {})


class FakeDocumentRef:
    def __init__(self, collection: "FakeCollectionRef", doc_id: str):
        self._collection = collection
        self.id = doc_id

    def get(self) -> FakeDocumentSnapshot:
        return FakeDocumentSnapshot(self.id, self._collection._docs.get(self.id))

    def set(self, data: Dict[str, Any]) -> None:
        self._collection._docs[self.id] = dict(data)

    def update(self, patch: Dict[str, Any]) -> None:
        existing = self._collection._docs.get(self.id)
        if existing is None:
            existing = {}
            self._collection._docs[self.id] = existing
        existing.update(dict(patch))

    def delete(self) -> None:
        self._collection._docs.pop(self.id, None)

    @property
    def reference(self) -> "FakeDocumentRef":
        # Firestore snapshots often expose .reference; some code expects it.
        return self


class FakeQuery:
    def __init__(self, collection: "FakeCollectionRef", filters: List[Tuple[str, str, Any]]):
        self._collection = collection
        self._filters = list(filters)
        self._limit: Optional[int] = None

    def where(self, field: str, op: str, value: Any) -> "FakeQuery":
        return FakeQuery(self._collection, self._filters + [(field, op, value)])

    def limit(self, n: int) -> "FakeQuery":
        self._limit = n
        return self

    def stream(self) -> Iterable[FakeDocumentSnapshot]:
        matched: List[FakeDocumentSnapshot] = []
        for doc_id, data in self._collection._docs.items():
            ok = True
            for field, op, value in self._filters:
                if op != "==":
                    raise NotImplementedError(f"FakeQuery only supports '==', got {op}")
                if (data or {}).get(field) != value:
                    ok = False
                    break
            if ok:
                matched.append(FakeDocumentSnapshot(doc_id, data))
        if self._limit is not None:
            matched = matched[: self._limit]
        return iter(matched)


def _field_filter_to_tuple(filter_obj: Any) -> Tuple[str, str, Any]:
    """Extract (field, op, value) from a Firestore FieldFilter-like object."""
    field = getattr(filter_obj, "field_path", None)
    if field is None:
        field = getattr(filter_obj, "field", None)
    if hasattr(field, "field_path"):
        field = field.field_path
    if isinstance(field, list):
        field = ".".join(field)
    op = getattr(filter_obj, "op_string", None) or getattr(filter_obj, "op", None) or "=="
    value = getattr(filter_obj, "value", None)
    return (str(field), str(op), value)


class FakeCollectionRef:
    def __init__(self, name: str):
        self._name = name
        self._docs: Dict[str, Dict[str, Any]] = {}

    def document(self, doc_id: Optional[str] = None) -> FakeDocumentRef:
        if doc_id is None:
            doc_id = uuid.uuid4().hex
        return FakeDocumentRef(self, doc_id)

    def add(self, data: Dict[str, Any]):
        ref = self.document()
        ref.set(data)
        return ref, None

    def where(self, field: Optional[str] = None, op: Optional[str] = None, value: Any = None, **kwargs: Any) -> FakeQuery:
        filter_obj = kwargs.get("filter")
        if filter_obj is not None:
            field, op, value = _field_filter_to_tuple(filter_obj)
        if field is None or op is None:
            raise TypeError("where() requires (field, op, value) or filter=FieldFilter(...)")
        return FakeQuery(self, [(field, op, value)])

    def stream(self) -> Iterable[FakeDocumentSnapshot]:
        return iter(FakeDocumentSnapshot(doc_id, data) for doc_id, data in self._docs.items())


class FakeFirestore:
    def __init__(self):
        self._collections: Dict[str, FakeCollectionRef] = {}

    def collection(self, name: str) -> FakeCollectionRef:
        if name not in self._collections:
            self._collections[name] = FakeCollectionRef(name)
        return self._collections[name]

