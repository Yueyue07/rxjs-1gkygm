import './style.css';

import {
  of,
  map,
  timer,
  throwError,
  lastValueFrom,
  Observable,
  Subject,
  interval,
} from 'rxjs';

import {
  catchError,
  concatMap,
  delay,
  filter,
  last,
  mergeMap,
  repeat,
  switchMap,
  take,
  takeWhile,
  tap,
} from 'rxjs/operators';
import { ajax } from 'rxjs/ajax';

class ApplyChangeWithPolling {
  private hasPendingPollingRequest: boolean = false;
  private pendingId: number;
  private applyChangeResponse = [
    'succeed',
    'failed',
    'succed with pending request',
    'succed with pending request',
    'succed with pending request',
    'succed with pending request',
    'succed with pending request',
    'succed with pending request',
  ];
  private times: number = 1;
  private timer$ = timer(0, Math.pow(2, 1) * 100);
  private pendingChangeResponse = [
    'pending',
    'pending',
    'pending',
    'pending',
    'pending',
    'pending',
    'succeed',
    'failed',
  ];
  public uiBlocking: Subject<boolean> = new Subject<boolean>();
  private pollingValue$: Subject<string> = new Subject<string>();
  private needsPolling: boolean = true;

  constructor() {}

  private exponentialTimeBackOff(): void {
    setTimeout(() => {
      console.log('delay time', this.delayTime());
      this.pollingValue$.next('next');
      if (this.needsPolling) {
        this.times = this.times + 1;
        this.exponentialTimeBackOff();
      } else {
        console.log('complete polling');
        this.pollingValue$.complete();
      }
    }, this.delayTime());
  }

  private delayTime(): number {
    return Math.pow(2, this.times) * 100;
  }

  public async callApplyChangeWithPolling(): Promise<void> {
    console.log('has pending polling requests', this.hasPendingPollingRequest);
    const poll1 = await lastValueFrom(this.pollingRequest$);
    console.log('poll1 result', poll1);
    //const poll2 = await lastValueFrom(this.pollingRequest$);
    // if (this.hasPendingPollingRequest) {
    //   // await for pendingRequest complete
    //   return lastValueFrom(this.callApplyChange());
    // }
    // return lastValueFrom(this.callApplyChange());
  }

  private applyChange$ = this.applyChangeRequest().pipe(
    map((val) => {
      console.log(`apply change ${val[0]}`);
      console.log('Stop UI Block');
      this.uiBlocking.next(false);

      if (val[0] === 'succeed') {
        console.log('update model version number');
      } else if (val[0] === 'succed with pending request') {
        console.log('save the current data model state');
        this.pendingId = val[1] as number;
      }
      console.log('update UI with new model state');
      return val;
    }),
    catchError((val) => {
      this.uiBlocking.next(false);
      console.log('apply change failed');
      console.log('Stop UI Block');
      console.log('Apply change error andling');
      console.log('Roll back UI with last good state');
      return val;
    })
  );

  private callPollingRequest(): Observable<string> {
    this.exponentialTimeBackOff();
    return this.pollingValue$.pipe(
      // tap((timer) => {
      //   console.log(timer);
      //   this.times = this.times + 1;
      // }),
      mergeMap(() =>
        // sending our request parellely
        this.pendingChangeRequest().pipe(
          tap((v) => console.log('pending result value', v)),
          map((val) => val),
          catchError((error) => of(error))
        )
      ),
      takeWhile((val) => {
        return val === 'pending';
      }, true),
      last(),
      tap((val) => {
        this.needsPolling = false;
        console.log('pending change request', val);
      }),
      map((val) => {
        this.hasPendingPollingRequest = false;
        if (val === 'failed') {
          this.uiBlocking.next(false);
          console.log('notification: previous changes are failed in service');
          console.log('UI roll back to previously saved data model state');
          return 'polling apply change failed';
        } else {
          return 'polling apply change succeed';
        }
      })
    );
  }

  private pollingRequest$ = this.timer$.pipe(
    mergeMap(() =>
      // sending our request parellely
      this.pendingChangeRequest().pipe(
        tap((v) => console.log('pending change request result value', v)),
        map((val) => val),
        catchError((error) => of(error))
      )
    ),
    tap((val) => console.log('pending change request', val)),
    takeWhile((val) => {
      return val === 'pending';
    }, true),
    tap((val) => {
      this.needsPolling = false;
    }),
    filter((v) => v !== 'pending'),
    map((val) => {
      this.hasPendingPollingRequest = false;
      if (val === 'failed') {
        this.uiBlocking.next(false);
        console.log('notification: previous changes are failed in service');
        console.log('UI roll back to previously saved data model state');
        return 'polling apply change failed';
      } else {
        return 'polling apply change succeed';
      }
    })
  );

  private callApplyChange() {
    console.log('Start UI Block');
    this.uiBlocking.next(true);
    return this.applyChange$.pipe(
      filter((val) => val[0] === 'succed with pending request'),
      tap(() => {
        this.hasPendingPollingRequest = true;
        this.needsPolling = true;
      }),
      take(1),
      concatMap((val) => this.callPollingRequest())
    );
  }

  private getRandomInt(max) {
    return Math.floor(Math.random() * max);
  }

  private applyChangeRequest() {
    const index = this.getRandomInt(this.applyChangeResponse.length);
    if (index === 1) {
      return ajax('https://jsonplaceholder.typicode.com/todos/1').pipe(
        switchMap(() => throwError([this.applyChangeResponse[index], index]))
      );

      // throwError([this.applyChangeResponse[index], index]).pipe(
      //   delay(2000)
      // );
    }
    return ajax('https://jsonplaceholder.typicode.com/todos/1').pipe(
      map((v) => [this.applyChangeResponse[index], index])
    );
    // of([this.applyChangeResponse[index], index]).pipe(delay(2000));
  }

  private pendingChangeRequest() {
    console.log('pendingRequestId', this.pendingId);
    const index = this.getRandomInt(this.pendingChangeResponse.length);
    if (index === 5) {
      return throwError(this.pendingChangeResponse[index]).pipe(delay(2000));
    }
    return of(this.pendingChangeResponse[index]).pipe(delay(2000));
  }
}

async function callPendingChange() {
  const example = new ApplyChangeWithPolling();
  const result = example.callApplyChangeWithPolling();
  // console.log('log result');
  // console.log('result');
  // console.log(result);
  // example.uiBlocking.pipe(take(2)).subscribe((v) => {
  //   console.log('ui blocking value', v);
  //   if (!v) {
  //     example.callApplyChangeWithPolling();
  //   }
  // });
}

callPendingChange();

// const example = new ApplyChangeWithPolling();
// const result = await example.callApplyChangeWithPolling();
// console.log('result', result);

// setTimeout(() => {
//   callPendingChange();
// }, 4000);
// console.log(' I start synchronous log ');
// of(2).subscribe(() => {
//   console.log('I am middle synchronous log ');
// });
// console.log('I end synchronous log ');

// async function tryObservablePromiseExample() {
//   const result = await of(1, 3, 5)
//     .pipe(
//       map((v) => v),
//       // filter((v) => v % 2 === 0),
//       map((v) => 'succeed')
//     )
//     .toPromise();
//   console.log(result);
// }

// tryObservablePromiseExample();
// let times = 1;
// function delayTime() {
//   return Math.pow(2, times) * 100;
// }
// timer(0, delayTime())
//   .pipe(
//     tap((v) => (times = times + 1)),
//     take(10)
//   )
//   .subscribe((timer) => {
//     console.log('times', times);
//     console.log(timer);
//   });

// interval(1000)
//   .pipe(
//     delay(3000),
//     tap((v) => (times = times + 1)),
//     take(10)
//   )
//   .subscribe((timer) => console.log(timer));

const value$ = of(1);
lastValueFrom(value$);

// of(1, 3, 4, 5)
//   .pipe(
//     takeWhile((v) => v % 2 !== 0, true),
//     tap((v) => console.log(v))
//   )
//   .subscribe((v) => console.log(v));
