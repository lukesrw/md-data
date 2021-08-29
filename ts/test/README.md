# MDData

## Description

> Middleware for producing SQL queries from Markdown

-   Quickly create sample schema/data for prototyping or testing
-   Investigate how your relational database could be normalized further
-   Easily create, update, and manage a static database without having to write any SQL queries

Currently only SQLite is fully supported, with support for MySQL being worked on.

## Usage

### Headings

For MDData the format of Markdown headings is the following:

```md
[Depth] [Name] ([Type])
```

| Item  | Description                                              | Example           |
| ----- | -------------------------------------------------------- | ----------------- |
| Depth | Number of hashes for the depth of this record            | `##`              |
| Name  | Name to refer to this unique entity (see "Unique Depth") | `Sherlock Holmes` |
| Type  | Category of data (singular) that this record represents  | `occupant`        |

Depth is used when greater than 1 to find and assign a parent (with foreign key references), Name is used to merge duplicate records, and track data-over-time changes, and Type is used to group items, and name the table/table fields (e.g. "occupants", "occupant_uuid").

### Properties

For MDData the format of properties is the following, optional under each heading:

```md
-   Property Name: Property Value
```

"Property Value" by default is considered to be `TEXT`, but will be tested and converted to `INTEGER` or `REAL` if possible.

### Unique Depth

Name is used in order to track and refer to data-over-time from other records, however this relies on the name being unique. If the name is not unique this will cause collisions between multiple records, potentially combining their information.

The `toSQL()` method takes a `unique_depth` argument (default: 0) in order to instruct MDData to force headings less than or equal to that depth to be unique no matter what (at the moment this has the downside of meaning they cannot be referenced).

#### Example

With a `unique_depth` of 1:

```md
# Season 1 (season)

## Episode 1 (episode)

-   Title: Pilot

# Season 2 (season)

## Episode 1 (episode)

-   Title: Seven Thirty-Seven
```

In this Markdown example, "Season 1" and "Season 2" will always be unique (even if given the same name), however both "Episode 1" records are being interpreted as being the same record (with changes over time), so it would look like the title of episode 1 was changed for some reason in the future.

The ideal solution is to update the headings to be unique ("Pilot" instead of "Episode 1" for example), as this will allow you to refer to these records throughout your data (First Seen In: {Pilot}). Alternatively if this is not possible you can update the `unique_depth` to 2 when calling `toSQL()`, but you will not be able to use these unique headings as references.

### Code

```js
const { MDData } = require("md-data");

async function main() {
    /**
     * Step 1. Get data
     */
    // from JSON string
    let data = new MDData("[{}, {}, ...]");

    // from array
    let data = new MDData([{}, {}, ...]);

    // from MD string
    let data = MDData.fromMD("# heading ...");

    // from file (.md, .json)
    let data = await MDData.fromFile("./path/to/file.md");

    /**
     * Step 2. Convert data
     */
    // to MD string (duplicates merged, casing cleaned)
    let md = data.toMD();

    // to JSON string
    let json = data.toJSON();

    // to SQL string
    let sql = data.toSQL();

    // to file (.md, .json, .sql)
    await data.toFile("./path/to/file.sql");
}

main();
```

## Example

### Input: Markdown

```md
<MD1>
```

### Output: Markdown

```md
<MD2>
```

### Output: JSON

```json
<JSON>
```

### Output: SQL

```sql
<SQL>
```
