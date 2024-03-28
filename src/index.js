#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers')
const { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand } = require("@aws-sdk/client-route-53"); // CommonJS import
const client = new Route53Client();
const csv = require('csv-stringify/sync');
const { getLogger } = require('log4njs');
const { writeFile } = require('fs').promises;

const log = getLogger();
const options = _parseArgs();

(async function run() {
    log.info('Resolving hosted zones...');
    let hostedZones = await _listHostedZones();
    log.info(`Resolved ${hostedZones.size} hosted zones`);
    log.info('Resolving record sets...');
    await _getRecordSetsForZones(hostedZones);
    log.info('Record sets resolved');
    log.info('Finding matching records...');
    const matchingRecords = _findRecord(hostedZones, options);
    await _printResult(matchingRecords);
})();

/**
 * Recursively lists all hosted zones in the account and returns them as a Set
 *
 * @param {Set<HostedZone>} [hostedZones] Set containing already resolved Hosted Zones. New zones will be appended to this Set.
 * @param {string} [marker] Marker for pagination if there is more than one page
 * @returns {Promise<Set<HostedZone>>}
 * @private
 */
async function _listHostedZones(hostedZones = new Set(), marker = undefined) {
    const params = {
        Marker: marker,
    };
    const response = await client.send(new ListHostedZonesCommand(params));
    for (const hostedZone of response.HostedZones) {
        hostedZone.Id = hostedZone.Id.split('/').pop();
        hostedZones.add(hostedZone);
    }

    if (response.IsTruncated) {
        return await _listHostedZones(hostedZones, response.NextMarker);
    }
    return hostedZones;
}

/**
 *
 * @param {Set<HostedZone>} hostedZones
 * @private
 */
async function _getRecordSetsForZones(hostedZones) {
    for (const hostedZone of hostedZones.values()) {
        hostedZone.recordSets = await _getRecordSetsForZone(hostedZone);
    }
}

/**
 *
 * @param {HostedZone} hostedZone
 * @param {ResourceRecordSet[]} recordSets
 * @param startRecord
 * @returns {Promise<*|*[]>}
 * @private
 */
async function _getRecordSetsForZone(hostedZone, recordSets = [], startRecord = undefined) {
    const params = {
        HostedZoneId: hostedZone.Id,
        StartRecordName: startRecord?.name,
        StartRecordType: startRecord?.type,
        StartRecordIdentifier: startRecord?.identifier,
    };
    const response = await client.send(new ListResourceRecordSetsCommand(params));
    recordSets = recordSets.concat(response.ResourceRecordSets);
    if (response.IsTruncated) {
        return await _getRecordSetsForZone(hostedZone, recordSets, {
            name: response.NextRecordName,
            type: response.NextRecordType,
            identifier: response.NextRecordIdentifier,
        });
    }
    return recordSets;
}

function _findRecord(hostedZones) {
    const matchingRecords = [];
    for (const hostedZone of hostedZones.values()) {
        for (const recordSet of hostedZone.recordSets) {
            if (recordSet.AliasTarget) {
                if (_evaluateRecord(recordSet.AliasTarget.DNSName)) {
                    matchingRecords.push(
                        _createResultEntry(hostedZone, 'Alias', recordSet.Name, recordSet.AliasTarget.DNSName),
                    );
                }
            } else if (recordSet.ResourceRecords) {
                for (const record of recordSet.ResourceRecords) {
                    if (_evaluateRecord(record.Value)) {
                        matchingRecords.push(
                            _createResultEntry(hostedZone, recordSet.Type, recordSet.Name, record.Value),
                        );
                    }
                }
            } else {
                log.info('No AliasRecord or ResourceRecords found', recordSet)
            }
        }
    }
    return matchingRecords;

    function _evaluateRecord(recordValue) {
        if (options.match === 'regex') {
            return (new RegExp(options.record)).test(recordValue);
        }
        return recordValue === `${options.record}.` || recordValue === options.record;
    }

    function _createResultEntry(hostedZone, recordType, recordName, recordValue) {
        return {
            hostedZoneId: hostedZone.Id,
            hostedZoneName: hostedZone.Name,
            recordType,
            recordName,
            recordValue,
        }
    }
}

async function _printResult(matchingRecords) {
    switch (options.format) {
        case 'json':
            const jsonData = JSON.stringify(matchingRecords, null, 2);
            if (options.file) {
                await writeFile(options.file, jsonData);
            } else {
                log.info(jsonData);
            }
            break;
        case 'csv':
            const csvData = csv.stringify(matchingRecords, { header: options.csvHeaders });
            if (options.file) {
                await writeFile(options.file, csvData);
            } else {
                log.info(csvData);
            }
            break;
    }

    if (options.showCount) {
        log.info(`Total count: ${matchingRecords.length}`);
    }
}

function _usage() {
    log.getSettings().hideLogLevel = true;
    log.info('');
    log.info('Usage:');
    log.info('node record-finder.js --record my-record');
    log.info('');
    log.info('Arguments:');
    log.info('record: Name of the record to search for. If type is set to regex, the record will be treated as a regex.');
    log.info('[match]: To match records using regex, set this to "regex". If not, records are matched using string equality');
    log.info('[format]: csv or json. json is default');
    log.info('[no-csv-headers]: Exclude csv headers');
    log.info('[file]: Specify if you want the result written to file rather than be printed on stdout. Relative to pwd. E.g., ../result/file.csv');
    log.info('[show-count]: print the total number of matching records to stdout');
    process.exit();
}

function _parseArgs() {
    const argv = yargs(hideBin(process.argv)).argv;
    // Defaults
    const options = {
        record: null,
        format: 'json',
        csvHeaders: true,
        showCount: false,
        match: 'equality',
        file: null,
    };

    if (argv['help']) {
        _usage();
    }
    if (!argv.record) {
        log.error('No record supplied');
        _usage();
    }
    options.record = argv.record;

    if (argv.format?.toLowerCase() === 'csv') {
        options.format = 'csv';
    }
    // Yargs will translate --no-csv-headers to csv-headers=false
    if (argv['csv-headers'] === false) {
        options.csvHeaders = false;
    }
    if (argv['show-count']) {
        options.showCount = true;
    }
    if (argv.match?.toLowerCase() === 'regex') {
        options.match = 'regex';
    }
    if (argv['file']) {
        options.file = argv['file'];
    }

    return options;
}
