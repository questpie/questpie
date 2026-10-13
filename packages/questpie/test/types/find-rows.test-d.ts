/**
 * findRows: bounded backend rows without a total. The request type must make
 * the bound mandatory and paging coordinates unrepresentable, and must leave
 * `find` with its paginated result.
 */

import type { CRUD } from "#questpie/server/collection/crud/types.js";

import type { Equal, Expect, IsAny } from "./type-test-utils.js";

type Row = { id: string; title: string };
declare const crud: CRUD<Row>;

const rows = crud.findRows({ limit: 10, where: { title: "a" } });
type Rows = Awaited<typeof rows>;
type _rowsIsArray = Expect<Equal<Rows extends unknown[] ? true : false, true>>;
type _rowIsNotAny = Expect<Equal<IsAny<Rows[number]>, false>>;
type _rowHasTitle = Expect<Equal<Rows[number]["title"], string>>;
type _rowsHaveNoTotal = Expect<
	Equal<"totalDocs" extends keyof Rows ? true : false, false>
>;

// @ts-expect-error the bound is mandatory
void crud.findRows({});
// @ts-expect-error offset paging is not part of the contract
void crud.findRows({ limit: 10, offset: 0 });
// @ts-expect-error grouping is not part of the contract
void crud.findRows({ limit: 10, groupBy: "title" });

const page = crud.find({ limit: 10 });
type _findKeepsTotal = Expect<Equal<Awaited<typeof page>["totalDocs"], number>>;
type _findKeepsDocs = Expect<
	Equal<Awaited<typeof page>["docs"][number]["title"], string>
>;
