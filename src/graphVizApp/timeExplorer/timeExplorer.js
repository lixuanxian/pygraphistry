'use strict';

var debug   = require('debug')('graphistry:StreamGL:graphVizApp:TimeExplorer');
var $       = window.$;
var Rx      = require('rxjs/Rx.KitchenSink');
              require('../../rx-jquery-stub');
var _       = require('underscore');
var Handlebars = require('handlebars');
var Backbone = require('backbone');
    Backbone.$ = $;

var d3 = require('d3');
var Command = require('../command.js');
var util    = require('../util.js');
var FilterControl = require('../FilterControl.js');
var Identifier = require('../Identifier');
var contentFormatter = require('../contentFormatter.js');

var TimeExplorerPanel = require('./TimeExplorerPanel.js');
var timeExplorerUtils = require('./timeExplorerUtils.js');

//////////////////////////////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////////////////////////
// Explorer / Data Management
//////////////////////////////////////////////////////////////////////////////

// TODO: Use proper IDs
var lastId = 0;
function getId () {
    return lastId++;
}

function TimeExplorer (socket, $div, filtersPanel) {
    var that = this;
    this.$div = $div;
    this.socket = socket;
    this.filtersPanel = filtersPanel;

    this.zoomRequests = new Rx.ReplaySubject(1);
    this.zoomCount = 0;

    this.getTimeDataCommand = new Command('getting time data', 'timeAggregation', socket);
    this.getTimeBoundsCommand = new Command('getting time bounds', 'getTimeBoundaries', socket);
    this.namespaceMetadataCommand = new Command('getting namespace metadata', 'get_namespace_metadata', socket);

    this.dataModelSubject = new Rx.ReplaySubject(1);
    this.dataModelSubject.onNext(timeExplorerUtils.baseDataModel);
    this.dataModelDiffer = timeExplorerUtils.makeDataModelDiffer();

    this.barModelSubjects = [];
    this.globalBarModelSubject = new Rx.ReplaySubject(1);
    this.globalBarModelSubject.onNext(timeExplorerUtils.baseGlobalBar);

    var allBar = new Rx.ReplaySubject(1);
    var allBarModel = _.clone(timeExplorerUtils.baseUserBar);
    allBarModel.showTimeAggregationButtons = true;
    allBarModel.id = getId();
    allBar.onNext(allBarModel);
    this.barModelSubjects.push(allBar);

    // When we change timeDesc/timeAgg, update global bounds
    this.dataModelSubject.do((newModel) => {
        // Handle various updates
        var changedKeys = this.dataModelDiffer(newModel);

        // handles time attribute changes
        if (_.intersection(changedKeys, ['timeAttr', 'timeType']).length > 0) {
            // update global bounds
            this.updateGlobalTimeBounds(newModel);
        }

        if (_.intersection(changedKeys, ['filterTimeBounds']).length > 0) {
            // Update filters on rest of graph
            this.updateGraphTimeFilter(newModel);
        }

    }).subscribe(_.identity, util.makeErrorHandler('updating time data model'));




    // this.activeQueries = [];
    // this.queryChangeSubject = new Rx.ReplaySubject(1);

    // this.queryChangeSubject.filter(function (desc) {
    //         // Not initialized
    //         return !(_.contains(_.values(desc), null));
    //     }).flatMap(function (timeDesc) {
    //         // console.log('WE GETTING TIME DATA');
    //         var timeType = timeDesc.timeType;
    //         var timeAttr = timeDesc.timeAttr;
    //         var timeAggregation = timeDesc.timeAggregation;
    //         var start = timeDesc.start;
    //         var stop = timeDesc.stop;
    //         return that.getMultipleTimeData(timeType, timeAttr, start, stop, timeAggregation, that.activeQueries);
    //     }).do(function (data) {
    //         // debug('GOT NEW DATA: ', data);
    //         var dividedData = {};
    //         dividedData.all = data.All;
    //         delete data.All;
    //         dividedData.user = data;
    //         dividedData.maxBinValue = dividedData.all.maxBin;

    //         // debug('DIVIDED DATA: ', dividedData);

    //         that.panel.model.set(dividedData);
    //     }).subscribe(_.identity, util.makeErrorHandler('Error getting time data stream'));


    // this.queryChangeSubject.onNext(this.timeDescription);

    this.setupZoom();

    // Get data necessary to render timeExplorerPanel
    this.namespaceMetadataCommand.sendWithObservableResult().do((metadata) => {
        this.panel = new TimeExplorerPanel(socket, $div, metadata.metadata, this);
    }).subscribe(_.identity, util.makeErrorHandler('Error grabbing metadata for time explorer'));

    debug('Initialized Time Explorer');
}

TimeExplorer.prototype.updateGlobalTimeBounds = function (model) {
    var obj = {
        timeAttr: model.timeAttr,
        timeType: model.timeType
    };

    this.getTimeBoundsCommand.sendWithObservableResult(obj)
        .do((timeBounds) => {
            var {min, max} = timeBounds;
            var newModel = _.clone(model);
            newModel.globalTimeBounds = {start: min, stop: max};

            // Set local time bounds if they don't exist
            // TODO: Deal with this more naturally / separately
            if (newModel.localTimeBounds.start === null || newModel.localTimeBounds.stop === null) {
                newModel.localTimeBounds = {start: min, stop: max};
            }

            this.dataModelSubject.onNext(newModel);
        }).subscribe(_.identity, util.makeErrorHandler('Error grabbing global time bounds'));
};


TimeExplorer.prototype.updateGraphTimeFilter = function (model) {

    var filtersCollection = this.filtersPanel.collection;
    var filterModel = filtersCollection.findWhere({
        controlType: 'timeExplorer'
    });

    if (model.filterTimeBounds && model.filterTimeBounds.start && model.filterTimeBounds.stop) {

        console.log('Filter time bounds: ', model.filterTimeBounds);

        var combinedAttr = '' + Identifier.clarifyWithPrefixSegment(model.timeAttr, model.timeType);
        var timeFilterQuery = combinedAttr + ' >= ' + model.filterTimeBounds.start + ' AND ' + combinedAttr + ' <= ' + model.filterTimeBounds.stop;

        var query = this.makeQuery(model.timeType, model.timeAttr, timeFilterQuery).query;

        if (filterModel === undefined) {
            // Make new
            filtersCollection.addFilter({
                attribute: model.timeAttr,
                dataType: 'number', // TODO: make this a date type
                controlType: 'timeExplorer',
                query: query
            });

        } else {
            // Update
            filterModel.set('query', query);
        }

    } else {
        // Delete
        filtersCollection.remove(filterModel);
    }
};

TimeExplorer.prototype.addActiveQuery = function (type, attr, string) {

    var newBar = new Rx.ReplaySubject(1);
    var newBarModel = _.clone(timeExplorerUtils.baseUserBar);

    newBarModel.id = getId();
    newBarModel.filter = this.makeQuery(type, attr, string);
    // newBarModel.filter = {
    //     type, attr, query: this.makeQuery(type, attr, string)
    // };

    newBar.onNext(newBarModel);
    this.barModelSubjects.push(newBar);
    this.panel.view.updateChildrenViewList();
};



// TimeExplorer.prototype.addActiveQuery = function (type, attr, string) {
//     var formattedQuery = this.makeQuery(type, attr, string);
//     this.activeQueries.push({
//         name: string,
//         query: formattedQuery
//     });
//     this.modifyTimeDescription({}); // Update. TODO: Make an actual update func
// };

TimeExplorer.prototype.makeQuery = function (type, attr, string) {
    return {
        type: type,
        attribute: attr,
        query: FilterControl.prototype.queryFromExpressionString(string)
    };
};

// TimeExplorer.prototype.getTimeData = function (timeType, timeAttr, start, stop, timeAggregation, otherFilters, name) {
//     // FOR UberAll
//     // LARGEST      2007-01-07T23:59:24+00:00
//     // SMALLEST     2007-01-01T00:01:24+00:00
//     // timeExplorer.realGetTimeData('point', 'time', '2007-01-01T00:01:24+00:00', '2007-01-07T23:59:24+00:00', 'day', [])
//     // timeExplorer.realGetTimeData('point', 'time', '2007-01-01T00:01:24+00:00', '2007-01-07T23:59:24+00:00', 'day', [timeExplorer.makeQuery('point', 'trip', 'point:trip > 5000')])

//     // console.log('GET TIME DATA');

//     var combinedAttr = '' + Identifier.clarifyWithPrefixSegment(timeAttr, timeType);
//     var timeFilterQuery = combinedAttr + ' >= ' + start + ' AND ' + combinedAttr + ' <= ' + stop;

//     var timeFilter = {
//         type: timeType,
//         attribute: timeAttr,
//         query: FilterControl.prototype.queryFromExpressionString(timeFilterQuery)
//     };

//     var filters = otherFilters.concat([timeFilter]);

//     var payload = {
//         start: start,
//         stop: stop,
//         timeType: timeType,
//         timeAttr: timeAttr,
//         timeAggregation: timeAggregation,
//         filters: filters
//     };

//     // console.log('SENDING TIME DATA COMMAND');

//     return this.getTimeDataCommand.sendWithObservableResult(payload)
//         .map(function (resp) {
//             // console.log('payload: ', payload);
//             resp.data.name = name;
//             return resp.data;
//         });
// };


TimeExplorer.prototype.getMultipleTimeData = function (timeType, timeAttr, start, stop, timeAggregation, activeQueries) {
    var that = this;
    var subjects = _.map(activeQueries, function (queryWrapper) {
        return that.getTimeData(timeType, timeAttr, start, stop, timeAggregation, [queryWrapper.query], queryWrapper.name);
    });

    var allSubject = that.getTimeData(timeType, timeAttr, start, stop, timeAggregation, [], 'All');
    subjects.push(allSubject);

    var zipFunc = function () {
        // debug('zipping');
        var ret = {};
        for (var i = 0; i < arguments.length; i++) {
            var obj = arguments[i];
            ret[obj.name] = obj;
        }
        // console.log('RET: ', ret);
        return ret;
    };

    subjects.push(zipFunc);

    return Rx.Observable.zip.apply(Rx.Observable, subjects);

    // return Rx.Observable.zip(subjects, zipFunc);
};

TimeExplorer.prototype.zoomTimeRange = function (zoomFactor, percentage, dragBox, vizContainer) {
    // console.log('GOT ZOOM TIME REQUEST: ', arguments);
    // Negative if zoom out, positive if zoom in.


    // HACK UNTIL FIGURE OUT BACKPRESS IN RX5
    this.zoomCount++;

    var adjustedZoom = 1.0 - zoomFactor;

    // console.log('zoomReq: ', adjustedZoom);

    var params = {
        percentage: percentage,
        zoom: adjustedZoom,
        dragBox: dragBox,
        vizContainer: vizContainer
    };

    this.zoomRequests.onNext(params);
};

TimeExplorer.prototype.setupZoom = function () {

    this.zoomRequests
        .inspectTime(timeExplorerUtils.ZOOM_POLL_RATE)
        .flatMap((request) => {
            return this.dataModelSubject
                .take(1)
                .map(function (model) {
                    return {request, model};
                });
        }).do((data) => {
            var {request, model} = data;

            // var total = req.numLeft + req.numRight + 1;
            var numStart = (new Date(model.localTimeBounds.start)).getTime();
            var numStop = (new Date(model.localTimeBounds.stop)).getTime();

            var newStart = numStart;
            var newStop = numStop;

            // console.log('numStart, numStop: ', numStart, numStop);

            for (var i = 0; i < this.zoomCount; i++) {
                var diff = newStop - newStart;

                var leftRatio = request.percentage;// (req.numLeft/total) || 1; // Prevents breaking on single bin
                var rightRatio = 1 - request.percentage;// (req.numRight/total) || 1;

                // Scale diff based on how many zoom requests
                // minus raw = in, so pos diff or delta

                // Deltas are represented as zoom in, so change towards a smaller window
                var startDelta = leftRatio * diff * request.zoom;
                var stopDelta = rightRatio * diff * request.zoom;

                newStart += Math.round(startDelta);
                newStop -= Math.round(stopDelta);

            }

            this.zoomCount = 0;

            // Guard against stop < start
            if (newStart >= newStop) {
                newStart = newStop - 1;
            }

            var newModel = _.clone(model);
            newModel.localTimeBounds = {
                start: newStart,
                stop: newStop
            };

            this.dataModelSubject.onNext(newModel);

        }).subscribe(_.identity, util.makeErrorHandler('zoom request handler'));

};


module.exports = TimeExplorer;
