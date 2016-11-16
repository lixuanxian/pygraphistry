import { Observable } from 'rxjs';
import { listConnectors } from '.';
import logger from '../logger.js';
import VError from 'verror';

const log = logger.createLogger('pivot-app', __filename);

const connectorMap = listConnectors();

export function checkConnector({ loadConnectorsById, connectorIds }) {
    return loadConnectorsById({ connectorIds })
        .mergeMap(({app, connector}) => {
            const connectorClass = connectorMap[connector.id];

            return connectorClass.login()
                .do(() => {
                    const lastUpdated = new Date().toLocaleString();
                    connector.status = {
                        level: 'success',
                        message: 'Health checks passed',
                        lastUpdated: lastUpdated
                    };
                })
                .map(() => ({app, connector}))
                .catch((e) =>
                    Observable.throw(
                        new VError.WError({
                            name:'ConnectorCheckFailed',
                            cause:e,
                        }, 'Connector check failed for : "%s"', connector.id)
                    )
                );
        });
}
