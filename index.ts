import {
  timer,
  throwError,
  Observable,
  Subject,
  BehaviorSubject,
  interval,
  iif,
} from 'rxjs';

import {
  map,
  catchError,
  concatMap,
  filter,
  mergeMap,
  switchMap,
  take,
  takeWhile,
  tap,
  delay,
} from 'rxjs/operators';
import { ajax } from 'rxjs/ajax';

enum PollingResult {
  Error = 'Error',
  Completed = 'Completed',
}

enum ApplyChangeResponse {
  Succeed = 'Succeed',
  Failed = 'Failed',
  SucceedWithPendingId = 'Succeed with pending id',
}

enum PollingResponse {
  Pending = 'Pending',
  Succeed = 'Succeed',
  Failed = 'Failed',
}

class ApplyChangeWithPolling {
  public uiBlocking: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  private hasPendingPollingRequest: boolean = false;
  private pendingId: string;
  private exponentTimes: number = 1;
  private pollingInterval$: Subject<string> = new Subject<string>();
  private needsPolling: boolean = true;
  private pollingResult: Promise<PollingResult>;
  private applyChangeResponse = [
    ApplyChangeResponse.Succeed,
    ApplyChangeResponse.Failed,
    ApplyChangeResponse.SucceedWithPendingId,
    ApplyChangeResponse.SucceedWithPendingId,
    ApplyChangeResponse.SucceedWithPendingId,
    ApplyChangeResponse.SucceedWithPendingId,
    ApplyChangeResponse.SucceedWithPendingId,
    ApplyChangeResponse.SucceedWithPendingId,
  ];
  private pendingChangeResponse = [
    PollingResponse.Pending,
    PollingResponse.Pending,
    PollingResponse.Pending,
    PollingResponse.Succeed,
    PollingResponse.Failed,
  ];

  constructor() {}

  public async callApplyChangeWithPolling(
    timeInterval: number = 1000,
    isPollingSequentially: boolean = true
  ): Promise<any> {
    logMessage('Start UI Block');
    this.uiBlocking.next(true);

    if (this.hasPendingPollingRequest) {
      // await for pendingRequest complete
      const result = await this.pollingResult;
      logMessage(`The previous pending polling request result: ${result}`);
      if (result === PollingResult.Error) {
        logMessage('Stop UI Block');
        this.uiBlocking.next(false);
        return;
      }
    }
    return this.callApplyChange(timeInterval, isPollingSequentially);
  }

  private getApplyChange() {
    return this.applyChangeRequest().pipe(
      map((val) => {
        logMessage(`apply change response: ${val[0]}`);
        logMessage('Stop UI Block');
        this.uiBlocking.next(false);

        if (val[0] === ApplyChangeResponse.Succeed) {
          logMessage('update model version number');
        } else if (val[0] === ApplyChangeResponse.SucceedWithPendingId) {
          logMessage('save the current data model state');
          this.pendingId = val[1];
        }
        logMessage('update UI with new model state');
        return val;
      }),
      catchError((val) => {
        this.uiBlocking.next(false);
        logMessage('apply change failed');
        logMessage('Stop UI Block');
        logMessage('Apply change error andling');
        logMessage('Roll back UI with last good state');
        return val;
      })
    );
  }

  public pollingRequestWithExponentialBackOff(
    timeInterval: number
  ): Observable<string> {
    this.needsPolling = true;
    this.pollingInterval$ = new Subject<string>();
    this.exponentialTimeBackOff(timeInterval);
    return this.pollingInterval$.pipe(
      mergeMap((v) => {
        logMessage('timer value', v);
        return this.pendingChangeRequest();
      }),
      catchError((error) => {
        this.hasPendingPollingRequest = false;
        this.needsPolling = false;
        logMessage('polling request result: ', error);
        logMessage('notification: previous changes are failed in service');
        logMessage('UI roll back to previously saved data model state');
        return throwError(error);
      }),
      takeWhile((val) => {
        return val === PollingResponse.Pending;
      }, true),
      tap((v) => logMessage('polling request result: ', v)),
      filter((v) => v !== PollingResponse.Pending),
      map((val) => {
        this.needsPolling = false;
        this.hasPendingPollingRequest = false;
        logMessage('polling request succeed');
        return 'polling apply change succeed';
      })
    );
  }

  public pollingRequestConcurrently(timeInterval: number) {
    return timer(0, timeInterval).pipe(
      mergeMap((v) => {
        logMessage('timer value: ', v);
        return this.pendingChangeRequest();
      }, 10),
      catchError((error) => {
        this.hasPendingPollingRequest = false;
        logMessage('polling request result: ', error);
        logMessage('notification: previous changes are failed in service');
        logMessage('UI roll back to previously saved data model state');
        return throwError(error);
      }),
      takeWhile((val) => {
        return val === PollingResponse.Pending;
      }, true),
      tap((v) => logMessage('polling request result: ', v)),
      filter((v) => v !== PollingResponse.Pending),
      take(1),
      map((val) => {
        this.hasPendingPollingRequest = false;
        logMessage('polling request succeed');
        return 'polling apply change succeed';
      })
    );
  }

  public pollingRequestSequentially(timeInterval: number) {
    return timer(0, timeInterval).pipe(
      concatMap((v) => {
        logMessage('timer value', v);
        return this.pendingChangeRequest();
      }),
      catchError((error) => {
        this.hasPendingPollingRequest = false;
        logMessage('polling request result: ', error);
        logMessage('notification: previous changes are failed in service');
        logMessage('UI roll back to previously saved data model state');
        return throwError(error);
      }),
      takeWhile((val) => {
        return val === PollingResponse.Pending;
      }, true),
      tap((v) => logMessage('polling request result: ', v)),
      filter((v) => v !== PollingResponse.Pending),
      map((val) => {
        this.hasPendingPollingRequest = false;
        logMessage('polling request succeed');
        return 'polling apply change succeed';
      })
    );
  }

  private callApplyChange(
    timeInterval: number,
    isPollingSequentially: boolean = true
  ) {
    this.pollingResult = new Promise((resolve, reject) => {
      this.getApplyChange()
        .pipe(
          tap((val: any[]) => {
            if (val[0] !== ApplyChangeResponse.SucceedWithPendingId) {
              resolve(PollingResult.Completed);
            }
          }),
          filter(
            (val: any[]) => val[0] === ApplyChangeResponse.SucceedWithPendingId
          ),
          tap(() => {
            this.hasPendingPollingRequest = true;
            this.needsPolling = true;
          }),
          take(1),
          concatMap((val) =>
            iif(
              () => isPollingSequentially,
              this.pollingRequestSequentially(timeInterval),
              this.pollingRequestConcurrently(timeInterval)
            )
          )
        )
        .subscribe(
          (v) => {
            logMessage('promise value: ', v);
          },
          (error) => {
            logMessage('promise error');
            resolve(PollingResult.Error);
          },
          () => {
            logMessage('promise completed');
            resolve(PollingResult.Completed);
          }
        );
    });
    return this.pollingResult;
  }

  private getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
  }

  private applyChangeRequest() {
    const index = this.getRandomInt(this.applyChangeResponse.length);
    const pendingRequestId = createUUID();
    if (this.applyChangeResponse[index] === ApplyChangeResponse.Failed) {
      return ajax('https://jsonplaceholder.typicode.com/posts/1/comments').pipe(
        delay(3000),
        switchMap(() =>
          throwError([this.applyChangeResponse[index], pendingRequestId])
        )
      );
    }
    return ajax('https://jsonplaceholder.typicode.com/posts/1/comments').pipe(
      map((v) => [this.applyChangeResponse[index], pendingRequestId])
    );
  }

  private pendingChangeRequest() {
    logMessage('pendingRequestId', this.pendingId);
    const index = this.getRandomInt(this.pendingChangeResponse.length);
    if (this.pendingChangeResponse[index] === PollingResponse.Failed) {
      return ajax('https://jsonplaceholder.typicode.com/posts/1/comments').pipe(
        delay(3000),
        switchMap(() => throwError(this.pendingChangeResponse[index]))
      );
    }
    return ajax('https://jsonplaceholder.typicode.com/posts/1/comments').pipe(
      map((v) => this.pendingChangeResponse[index])
    );
  }

  private exponentialTimeBackOff(timeInterval: number): void {
    setTimeout(() => {
      logMessage('delay time', this.delayTime(timeInterval));
      this.pollingInterval$.next('next');
      if (this.needsPolling) {
        this.exponentTimes = this.exponentTimes + 1;
        this.exponentialTimeBackOff(timeInterval);
      } else {
        logMessage('complete polling');
        this.pollingInterval$.complete();
      }
    }, this.delayTime(timeInterval));
  }

  private delayTime(timeInterval: number): number {
    return Math.pow(2, this.exponentTimes) * timeInterval;
  }
}

const example = new ApplyChangeWithPolling();

const input = document.getElementById('input') as HTMLInputElement;
let inputValue: number;
document.addEventListener('input', () => (inputValue = parseInt(input.value)));

function getTimeInterval() {
  return inputValue ? inputValue : 1000;
}

const button1 = document.getElementById('button1');
button1.addEventListener(
  'click',
  async () =>
    await example.pollingRequestConcurrently(getTimeInterval()).toPromise()
);

const button2 = document.getElementById('button2');
button2.addEventListener(
  'click',
  async () =>
    await example.pollingRequestSequentially(getTimeInterval()).toPromise()
);

const button3 = document.getElementById('button3');
button3.addEventListener(
  'click',
  async () =>
    await example
      .pollingRequestWithExponentialBackOff(getTimeInterval())
      .toPromise()
);

const button4 = document.getElementById('button4');
button4.addEventListener(
  'click',
  async () => await example.callApplyChangeWithPolling(getTimeInterval(), true)
);

const button6 = document.getElementById('button6');
button6.addEventListener(
  'click',
  async () => await example.callApplyChangeWithPolling(getTimeInterval(), false)
);

const selection = document.getElementById('selection');
const sequentialSection = document.getElementById('sequential-section');
const concurrentSection = document.getElementById('concurrent-section');
selection.addEventListener('change', (event) => {
  const value = (event as any).target.value;
  if (value === 'sequential') {
    sequentialSection.style.display = 'block';
    concurrentSection.style.display = 'none';
  } else if (value === 'concurrent') {
    sequentialSection.style.display = 'none';
    concurrentSection.style.display = 'block';
  }
});

const ul = document.getElementById('logging');
const button5 = document.getElementById('button5');
button5.addEventListener('click', () => (ul.innerHTML = ''));

const spinners = document.querySelectorAll('.spinner');
example.uiBlocking.subscribe((blockUI) => {
  if (blockUI) {
    button4.style.display = 'none';
    button4.style.display = 'none';
    for (let i = 0; i < spinners.length; i++) {
      (
        document.getElementsByClassName('spinner')[i] as HTMLElement
      ).style.display = 'block';
    }
  } else {
    button4.style.display = 'block';
    button4.style.display = 'block';
    for (let i = 0; i < spinners.length; i++) {
      (
        document.getElementsByClassName('spinner')[i] as HTMLElement
      ).style.display = 'none';
    }
  }
});

function logMessage(message: string, moreMessage?: string | number): void {
  const li = document.createElement('li');
  li.className = 'list-group-item';
  const id = document.getElementsByClassName('list-group-item').length + 1;
  const value = `${id}. ${message} ${
    moreMessage
      ? moreMessage
      : typeof moreMessage === 'number'
      ? moreMessage
      : ''
  }`;
  li.textContent = value;
  console.log(value);
  ul.appendChild(li);
}

function createUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
