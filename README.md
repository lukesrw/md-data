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

Depth is used when greater than 1 to find and assign a parent (with foreign key references).  
Name is used to merge duplicate records, and track data-over-time changes.  
Type is used to group items, and name the table/table fields (e.g. "occupants", "occupant_uuid").

### Properties

For MDData the format of properties is the following, optional under each heading:

```md
-   Property Name: Property Value
```

"Property Value" by default is considered to be `TEXT`, but will be tested and converted to `INTEGER` or `REAL` if possible.

### Unique Depth

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
# Headquarters (building)

-   House Number: 221b
-   Street: Baker Street
-   City: London
-   Postcode: NW1 6XE

## Sherlock Holmes (occupant)

-   Forename: Sherlock
-   Surname: Holmes

## John Watson (occupant)

-   Forename: John
-   Surname: Watson

```

### Output: Markdown

```md
# Headquarters (building)

-   House Number: 221b
-   Street: Baker Street
-   City: London
-   Postcode: NW1 6XE

## Sherlock Holmes (occupant)

-   Forename: Sherlock
-   Surname: Holmes

## John Watson (occupant)

-   Forename: John
-   Surname: Watson

```

### Output: JSON

```json
[
    {
        "depth": 1,
        "name": "headquarters",
        "type": "building",
        "children": [
            {
                "depth": 2,
                "name": "sherlock holmes",
                "type": "occupant",
                "children": [],
                "properties": {
                    "forename": "Sherlock",
                    "surname": "Holmes"
                }
            },
            {
                "depth": 2,
                "name": "john watson",
                "type": "occupant",
                "children": [],
                "properties": {
                    "forename": "John",
                    "surname": "Watson"
                }
            }
        ],
        "properties": {
            "house number": "221b",
            "street": "Baker Street",
            "city": "London",
            "postcode": "NW1 6XE"
        }
    }
]
```

### Output: SQL

```sql
CREATE TABLE IF NOT EXISTS `buildings` (
	`building_uuid` TEXT,
	`building_house_number` TEXT,
	`building_street` TEXT,
	`building_city` TEXT,
	`building_postcode` TEXT,

	PRIMARY KEY (`building_uuid`)
);

CREATE TABLE IF NOT EXISTS `occupants` (
	`occupant_building_uuid` TEXT,
	`occupant_uuid` TEXT,
	`occupant_forename` TEXT,
	`occupant_surname` TEXT,

	PRIMARY KEY (`occupant_building_uuid`, `occupant_uuid`),
	FOREIGN KEY (`occupant_building_uuid`) REFERENCES `buildings` (`building_uuid`)
);

INSERT INTO `buildings`
	(`building_uuid`, `building_house_number`, `building_street`, `building_city`, `building_postcode`) VALUES
	("d6f5388d-e078-4bfa-8e8c-595a7164c574", "221b", "Baker Street", "London", "NW1 6XE");

INSERT INTO `occupants`
	(`occupant_building_uuid`, `occupant_uuid`, `occupant_forename`, `occupant_surname`) VALUES
	("d6f5388d-e078-4bfa-8e8c-595a7164c574", "043474be-b7ee-4713-bc10-3c8604e34ef0", "Sherlock", "Holmes"),
	("d6f5388d-e078-4bfa-8e8c-595a7164c574", "12f6a2bb-4656-4df4-b2a9-2918812801cf", "John", "Watson");
```
