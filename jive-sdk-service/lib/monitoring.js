/*
 * Copyright 2013 Jive Software
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

/**
 * @module monitoring
 */

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// public

/**
 * Returns a JSON object consistent with https://community.jivesoftware.com/docs/DOC-134072
 */
exports.getStatus = function() {
    return testResults;
};

exports.runMonitoring = function() {
    var deferred = q.defer();

    runTests( deferred );

    return deferred.promise;
};

exports.addMonitor = function( testMeta ) {
    if ( !testMeta ) {
        // ignore empty test
        return;
    }

    var test = testMeta.test;
    if ( !test || typeof test !== 'function' ) {
        throw Error("Bad test -- invalid testing function");
    }

    var meta = testMeta.meta;
    if ( !meta ) {
        throw Error("Bad test -- no metadata");
    }

    var name = meta['name'];
    if ( !name ) {
        throw Error("Bad test -- invalid metadata: no name");
    }

    // all is well; add the test
    if ( !tests ) {
        tests = [];
    }
    tests.push( testMeta );
};

exports.createPersistenceMonitor = function() {
    var test = function() {
        var deferred = q.defer();

        jive.service.persistence().find('jiveExtension', {}).then( function(result) {
            if ( result ) {
                if ( result[0]['id'] ) {
                    deferred.resolve();
                } else {
                    deferred.reject('Error loading from db: jiveExtension.id');
                }
            } else {
                deferred.reject('Error loading from db: jiveExtension');
            }
        }, function(err) {
            deferred.reject('Error loading from db: ' + JSON.stringify(err));
        });

        return deferred.promise;
    };

    var meta = {
        'name' : 'persistence'
    };

    return {
        'test' : test,
        'meta' : meta
    };
};

exports.isActive = function() {
    return jive.service.options['monitoringInterval'];
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Private

var service = require('./service'),
    jive = require('../api'),
    q = require('q');

var tests;

var testResults = {};

var finalizeServiceStatus = function(e) {
    // make the call based on the resources
    var resources = testResults['resources'];
    var status = 'unknown';

    var faultCount = 0;
    var intermittentCount = 0;
    if ( resources ) {
        for ( var i = 0; i < resources.length; i++ ) {
            var resource = resources[i];
            var resourceStatus = resource['status'];
            if ( resourceStatus !== 'ok' ) {
                if ( resourceStatus === 'fault') {
                    faultCount++;
                } else {
                    intermittentCount++;
                }
            }
        }
    }

    if ( faultCount > 0 ) {
        status = 'fault';
    } else if ( intermittentCount > 0 ) {
        status = 'intermittent';
    } else {
        // no faults, no intermittent/unknown ... means we're ok!
        status = 'ok';
    }

    var now = new Date();
    var isoNow = now.toISOString();

    testResults['status'] = status;
    testResults['lastUpdate'] = isoNow;
};

var runTests = function(deferred) {
    // reinit test results
    testResults = {
        'status' : 'unknown'
    };

    if ( !tests ) {
        // all done
        deferred.resolve();
        return;
    }

    q.all( tests.map( executeTest ) ).then(
        function() {
            // all tests ran -- with errors or success
            finalizeServiceStatus();
            deferred.resolve();
        },

        function(e) {
            // unexpected error running the tests!
            // monitoring results are invalid
            finalizeServiceStatus(e);
            deferred.reject(e);
        }
    );
};

/**
 * @param testMeta
 */
var executeTest = function(testMeta) {
    var test = testMeta.test;
    var meta = testMeta.meta;

    if ( !meta ) {
        // todo log?
        return;
    }

    var name = meta['name'];

    if ( !name ) {
        // todo log?
        return;
    }

    var status = "unknown";
    var messages = [];

    var addResource = function() {
        var resources = testResults['resources'];
        if ( !resources ) {
            resources = [];
            testResults['resources'] = resources;
        }

        var resource = {
            'name': name,
            'status': status
        };
        if ( messages.length > 0 ) {
            resource['messages'] = messages;
        }

        resources.push(resource);
    };

    test().then(
        function(result) {
            status = 'ok';
            if ( result ) {
                messages.push( { 'summary': result } );
            }
            addResource();
        },

        function(err) {
            status = 'fault';
            if ( err) {
                messages.push( { 'summary': err } );
            }
            addResource();
        }
    );
};
