## Route53 Record Finder
The record finder lets you search through all hosted zones in a given AWS account
for a specific _**record value**_.

### Installation
```
npm i -g r53-find
```

### Setup
Before you run r53-find, make sure to prepare your shell by configuring AWS Credentials.<br>
You will need the following IAM permissions:
```
route53:ListHostedZones
route53:ListResourceRecordSets
```

### Usage
```
r53-find --record my-record-value
>
[
  {
    "hostedZoneName": "example.com.",
    "recordSet": {
      "Name": "foo.example.com.",
      "Type": "A",
      "AliasTarget": {
        "DNSName": "my-record-value."
      }
    }
  },
  ...
]
```

### Arguments
* `record` Name of the record to search for. If type is set to regex, the record will be treated as a regex. Required.
* `match` To match records using regex, set this to "regex". If not, records are matched using string equality
* `file`: Specify if you want the result written to file rather than be printed on stdout. Relative to `pwd`. E.g., ../result/file.csv
* `format` Output format. csv or json. json is default
* `no-csv-headers` Exclude csv headers
* `show-count`: print the total number of matching records to stdout

### Example
#### Look for any IPv4 record starting with 172 
```
r53-find \
    --record ^172(.[0-9]{1,3}){3}$ \
    --match regex \
    --file ./result.csv \
    --format csv \
    --no-csv-headers \
    --show-count
```
